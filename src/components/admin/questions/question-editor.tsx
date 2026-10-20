"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { type Question, CONTENT_KINDS, DIFFICULTIES, DIFFICULTY_LABEL, KINDS, KIND_LABEL, questionSchema } from "@/shared/questions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { LETTERS } from "./question-preview";

type Option = { kind: (typeof CONTENT_KINDS)[number]; content: string };
const blank: Question = { kind: "THEORY", prompt: "", code: null, language: null, runtimeContext: null, objective: "", topics: [], difficulty: "MEDIUM", expectedSeconds: 60, explanation: "", options: [{ kind: "TEXT", content: "", correct: true }, { kind: "TEXT", content: "", correct: false }] };

/** Creates a draft, or edits one when `draft` is given (its recordVersion detects concurrent edits). */
export function QuestionEditor({ initial = blank, draft }: { initial?: Question; draft?: { versionId: string; questionId: string; recordVersion: number } }) {
  const router = useRouter();
  const [kind, setKind] = useState(initial.kind);
  const [prompt, setPrompt] = useState(initial.prompt);
  const [code, setCode] = useState(initial.code ?? "");
  const [language, setLanguage] = useState(initial.language ?? "");
  const [runtimeContext, setRuntimeContext] = useState(initial.runtimeContext ?? "");
  const [objective, setObjective] = useState(initial.objective);
  const [topics, setTopics] = useState(initial.topics.join(", "));
  const [difficulty, setDifficulty] = useState(initial.difficulty);
  const [expectedSeconds, setExpectedSeconds] = useState(String(initial.expectedSeconds));
  const [explanation, setExplanation] = useState(initial.explanation);
  const [options, setOptions] = useState<Option[]>(initial.options.map(({ kind, content }) => ({ kind, content })));
  const [correct, setCorrect] = useState(Math.max(0, initial.options.findIndex((o) => o.correct)));
  const [errors, setErrors] = useState<string[]>([]);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const isCode = kind === "CODE";
  const bad = (field: string) => invalid.has(field) || undefined;

  function updateOption(index: number, patch: Partial<Option>) { setOptions(options.map((o, i) => i === index ? { ...o, ...patch } : o)); }
  function removeOption(index: number) {
    setOptions(options.filter((_, i) => i !== index));
    setCorrect(correct === index ? 0 : correct > index ? correct - 1 : correct);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const candidate = { kind, prompt, code: isCode ? code : "", language: isCode ? language : "", runtimeContext: isCode ? runtimeContext : "", objective, topics: topics.split(",").map((t) => t.trim()).filter(Boolean), difficulty, expectedSeconds: Number(expectedSeconds), explanation, options: options.map((o, i) => ({ ...o, correct: i === correct })) };
    const parsed = questionSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors([...new Set(parsed.error.issues.map((issue) => issue.message))]);
      setInvalid(new Set(parsed.error.issues.map((issue) => issue.path.slice(0, issue.path[0] === "options" && issue.path.length > 1 ? 2 : 1).join("."))));
      return;
    }
    setBusy(true); setErrors([]); setInvalid(new Set());
    try {
      const response = await fetch(draft ? `/api/v1/admin/questions/versions/${draft.versionId}` : "/api/v1/admin/questions", { method: draft ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft ? { expectedVersion: draft.recordVersion, question: parsed.data } : parsed.data) });
      const result = await response.json();
      if (!response.ok) { if (result.code === "STALE_DRAFT") setStale(true); throw new Error(result.message); }
      router.push(`/admin/questions/${draft?.questionId ?? result.questionId}`); router.refresh();
    } catch (error) { setErrors([error instanceof Error ? error.message : "Unable to save the question."]); setBusy(false); }
  }

  return <form className="space-y-6" onSubmit={save} noValidate>
    <Card><CardHeader><CardTitle><h2>Question</h2></CardTitle><CardDescription>Write the prompt students answer. Code is shown exactly as typed, with horizontal scrolling.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="kind">Type</Label><NativeSelect id="kind" className="w-full" value={kind} onChange={(e) => setKind(e.target.value as Question["kind"])}>{KINDS.map((k) => <NativeSelectOption key={k} value={k}>{KIND_LABEL[k]}</NativeSelectOption>)}</NativeSelect></div>
        <div className="space-y-2"><Label htmlFor="difficulty">Difficulty</Label><NativeSelect id="difficulty" className="w-full" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Question["difficulty"])}>{DIFFICULTIES.map((d) => <NativeSelectOption key={d} value={d}>{DIFFICULTY_LABEL[d]}</NativeSelectOption>)}</NativeSelect></div>
      </div>
      <div className="space-y-2"><Label htmlFor="prompt">Prompt</Label><Textarea id="prompt" rows={4} maxLength={5000} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-invalid={bad("prompt")} /></div>
      {isCode && <>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="language">Language</Label><Input id="language" placeholder="javascript" maxLength={40} value={language} onChange={(e) => setLanguage(e.target.value)} aria-invalid={bad("language")} /></div>
          <div className="space-y-2"><Label htmlFor="runtimeContext">Runtime context</Label><Input id="runtimeContext" placeholder="Node.js 24, CommonJS script" maxLength={500} value={runtimeContext} onChange={(e) => setRuntimeContext(e.target.value)} aria-invalid={bad("runtimeContext")} /></div>
        </div>
        <div className="space-y-2"><Label htmlFor="code">Code</Label><Textarea id="code" rows={10} wrap="off" spellCheck={false} className="font-mono text-sm" maxLength={10_000} value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={bad("code")} /></div>
      </>}
    </CardContent></Card>

    <Card><CardHeader><CardTitle><h2>Options</h2></CardTitle><CardDescription>Two to six options with exactly one correct answer. Options are shuffled for each student, so avoid &ldquo;All of the above&rdquo;.</CardDescription></CardHeader><CardContent className="space-y-4">
      <RadioGroup value={String(correct)} onValueChange={(value) => setCorrect(Number(value))} aria-label="Correct answer" className="gap-4">
        {options.map((option, i) => <div key={i} className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">Option {LETTERS[i]}</span>
            <div className="flex items-center gap-2"><RadioGroupItem value={String(i)} id={`correct-${i}`} /><Label htmlFor={`correct-${i}`} className="font-normal">Correct answer</Label></div>
            <NativeSelect aria-label={`Option ${LETTERS[i]} format`} size="sm" value={option.kind} onChange={(e) => updateOption(i, { kind: e.target.value as Option["kind"] })}><NativeSelectOption value="TEXT">Text</NativeSelectOption><NativeSelectOption value="CODE">Code</NativeSelectOption></NativeSelect>
            <Button type="button" variant="ghost" size="sm" className="ml-auto" disabled={options.length <= 2} onClick={() => removeOption(i)}><Trash2 aria-hidden="true" />Remove</Button>
          </div>
          <Textarea aria-label={`Option ${LETTERS[i]} content`} rows={option.kind === "CODE" ? 4 : 2} wrap={option.kind === "CODE" ? "off" : undefined} spellCheck={option.kind !== "CODE"} className={option.kind === "CODE" ? "font-mono text-sm" : undefined} maxLength={2000} value={option.content} onChange={(e) => updateOption(i, { content: e.target.value })} aria-invalid={bad(`options.${i}`)} />
        </div>)}
      </RadioGroup>
      <Button type="button" variant="outline" disabled={options.length >= 6} onClick={() => setOptions([...options, { kind: "TEXT", content: "" }])}><Plus aria-hidden="true" />Add option</Button>
    </CardContent></Card>

    <Card><CardHeader><CardTitle><h2>Classification and review</h2></CardTitle><CardDescription>Used to build balanced assessment sets. The explanation is shown to students only after results are released.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="objective">Learning objective</Label><Input id="objective" placeholder="Trace loop iterations" maxLength={160} value={objective} onChange={(e) => setObjective(e.target.value)} aria-invalid={bad("objective")} /></div>
        <div className="space-y-2"><Label htmlFor="expectedSeconds">Expected answering time (seconds)</Label><Input id="expectedSeconds" type="number" min={10} max={1800} value={expectedSeconds} onChange={(e) => setExpectedSeconds(e.target.value)} aria-invalid={bad("expectedSeconds")} /></div>
      </div>
      <div className="space-y-2"><Label htmlFor="topics">Topics</Label><Input id="topics" placeholder="Loops, Arrays" value={topics} onChange={(e) => setTopics(e.target.value)} aria-describedby="topics-help" aria-invalid={bad("topics")} /><p id="topics-help" className="text-sm text-muted-foreground">Separate up to five topics with commas.</p></div>
      <div className="space-y-2"><Label htmlFor="explanation">Explanation</Label><Textarea id="explanation" rows={4} maxLength={5000} value={explanation} onChange={(e) => setExplanation(e.target.value)} aria-invalid={bad("explanation")} /></div>
    </CardContent></Card>

    {errors.length > 0 && <Alert variant="destructive"><AlertTitle>{stale ? "This draft changed elsewhere" : "Check the question"}</AlertTitle><AlertDescription><ul className="list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul></AlertDescription></Alert>}
    <div className="flex flex-wrap gap-3">
      <Button type="submit" disabled={busy || stale}>{busy ? "Saving…" : draft ? "Save draft" : "Create draft"}</Button>
      {stale ? <Button type="button" variant="outline" onClick={() => window.location.reload()}>Reload latest draft</Button> : <Button type="button" variant="outline" disabled={busy} onClick={() => router.back()}>Cancel</Button>}
    </div>
  </form>;
}
