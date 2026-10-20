import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export type PreviewQuestion = {
  prompt: string; code: string | null; language: string | null; runtimeContext: string | null; explanation: string;
  options: { kind: "TEXT" | "CODE"; content: string; correct: boolean }[];
};
export const LETTERS = ["A", "B", "C", "D", "E", "F"];

/** React escapes all content, so question text and code can never run as HTML. */
export function CodeBlock({ code, language }: { code: string; language?: string | null }) {
  return <pre className="overflow-x-auto rounded-lg border bg-muted p-4 font-mono text-sm leading-relaxed" tabIndex={0} aria-label={language ? `${language} code` : "Code"}><code>{code}</code></pre>;
}

/** `answers` adds the correct option and explanation for the owner's review. */
export function QuestionPreview({ question, answers = false, idPrefix }: { question: PreviewQuestion; answers?: boolean; idPrefix: string }) {
  return <div className="space-y-5">
    <p className="whitespace-pre-wrap leading-relaxed">{question.prompt}</p>
    {question.code && <div className="space-y-2">{question.runtimeContext && <p className="text-sm text-muted-foreground">Context: {question.runtimeContext}</p>}<CodeBlock code={question.code} language={question.language} /></div>}
    <RadioGroup aria-label="Answer options" className="gap-3">
      {question.options.map((option, i) => <div key={i} className={cn("flex items-start gap-3 rounded-lg border p-3", answers && option.correct && "border-primary")}>
        <RadioGroupItem value={String(i)} id={`${idPrefix}-option-${i}`} className="mt-1" />
        <Label htmlFor={`${idPrefix}-option-${i}`} className="flex min-w-0 flex-1 flex-col items-start gap-2 font-normal">
          <span className="font-medium">{LETTERS[i]}</span>
          {option.kind === "CODE" ? <CodeBlock code={option.content} /> : <span className="whitespace-pre-wrap">{option.content}</span>}
        </Label>
        {answers && option.correct && <Badge>Correct</Badge>}
      </div>)}
    </RadioGroup>
    {answers && <div className="space-y-2 rounded-lg border bg-card p-4"><p className="text-sm font-medium">Explanation</p><p className="whitespace-pre-wrap text-sm text-muted-foreground">{question.explanation}</p></div>}
  </div>;
}
