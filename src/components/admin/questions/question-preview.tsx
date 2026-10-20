import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export type PreviewQuestion = {
  answerMode?: "SINGLE" | "MULTIPLE";
  prompt: string; code: string | null; language: string | null; runtimeContext: string | null; explanation: string;
  options: { kind: "TEXT" | "CODE"; content: string; correct: boolean }[];
};
export const LETTERS = ["A", "B", "C", "D", "E", "F"];

/** `answers` adds the correct option and explanation for the owner's review. */
export function QuestionPreview({ question, answers = false, idPrefix }: { question: PreviewQuestion; answers?: boolean; idPrefix: string }) {
  return <div className="space-y-5">
    <p className="whitespace-pre-wrap leading-relaxed">{question.prompt}</p>
    {question.code && <div className="space-y-2">{question.runtimeContext && <p className="text-sm text-muted-foreground">Context: {question.runtimeContext}</p>}<CodeBlock code={question.code} language={question.language} /></div>}
    {question.answerMode === "MULTIPLE" && <p className="text-sm text-muted-foreground"><Badge variant="secondary">Select all that apply</Badge> The point is awarded only for exactly the correct set.</p>}
    {(() => {
      // Mirrors the student exam rows so "Student view" shows exactly what students see.
      const control = "mt-0.5 border-foreground/50";
      const rows = question.options.map((option, i) => <Label key={i} htmlFor={`${idPrefix}-option-${i}`} className={cn("flex w-full items-start gap-3 rounded-lg border p-3 font-normal leading-relaxed", answers && option.correct && "border-primary")}>
        {question.answerMode === "MULTIPLE" ? <Checkbox id={`${idPrefix}-option-${i}`} className={control} /> : <RadioGroupItem value={String(i)} id={`${idPrefix}-option-${i}`} className={control} />}
        <span className="w-4 shrink-0 font-semibold">{LETTERS[i]}</span>
        <span className="min-w-0 flex-1">{option.kind === "CODE" ? <code className="block overflow-x-auto font-mono text-sm whitespace-pre">{option.content}</code> : <span className="whitespace-pre-wrap">{option.content}</span>}</span>
        {answers && option.correct && <Badge>Correct</Badge>}
      </Label>);
      return question.answerMode === "MULTIPLE" ? <div role="group" aria-label="Answer options" className="grid gap-2">{rows}</div> : <RadioGroup aria-label="Answer options" className="gap-2">{rows}</RadioGroup>;
    })()}
    {answers && <div className="space-y-2 rounded-lg border bg-card p-4"><p className="text-sm font-medium">Explanation</p><p className="whitespace-pre-wrap text-sm text-muted-foreground">{question.explanation}</p></div>}
  </div>;
}
