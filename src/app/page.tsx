import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, ClipboardCheck, Clock, Laptop, ListChecks, LogIn, Mail, MonitorCheck, Save, Shuffle, Wifi } from "lucide-react";
import { BRAND } from "@/shared/brand";
import { BrandMark } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const steps = [
  { icon: ClipboardCheck, title: "Your instructor enrols you", text: "Your instructor adds you to the class and assigns each assessment. Your dashboard shows when each one opens and how long it lasts." },
  { icon: Mail, title: "Sign in with a code", text: "Enter the email your instructor registered for you. We email a six-digit code to type in; there is no password." },
  { icon: ListChecks, title: "Answer and submit", text: "Answer the questions in any order and change your answers until you submit. You then get a receipt showing the submission time." },
];
const examFacts = [
  { icon: Clock, title: "Timer", text: "The time limit is set by your instructor and counted on the server, so changing your device's clock has no effect." },
  { icon: Save, title: "Saving", text: "Each answer is sent to the server when you choose it, and the screen shows whether it has been saved." },
  { icon: Shuffle, title: "Question sets", text: "Your instructor may use more than one set of questions. Answer options are shown in a different order for each student." },
  { icon: Laptop, title: "Code on screen", text: "Code is shown as written, and long lines scroll sideways. A laptop is easier for long code, but phones work too." },
];
const checklist = [
  "Use a charged laptop in a quiet place if you can.",
  "Make sure you can open your email, because you need it for the sign-in code.",
  "Read the rules page first. The timer starts when you press Start.",
  "Answer every question. Unanswered questions score zero, and wrong answers do not lose marks.",
];
const faqs = [
  { q: "How long does the sign-in code last?", a: "Two minutes, and it only works in the browser where you requested it. If it expires, request a new one." },
  { q: "What if my internet drops during an assessment?", a: "Keep the page open. Answers that were not saved stay on screen and are sent again when you reconnect. The timer keeps running, and only answers the server receives before the deadline count." },
  { q: "Can I go back and change an answer?", a: "Yes, until you submit or the time runs out. You can also mark questions for review and come back to them." },
  { q: "When will I see my results?", a: "Results are released after every student's time to answer has closed. Your instructor decides when." },
  { q: "Who can sign in?", a: "Students your instructor has enrolled, and the instructor. If the code does not arrive, check your spam folder, then ask your instructor to confirm the email they registered for you." },
];

// The only page search engines may index; it shares the root Open Graph card.
export const metadata: Metadata = {
  title: { absolute: BRAND.shareTitle },
  description: BRAND.shareDescription,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

export default function HomePage() {
  return <div className="min-h-svh">
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <BrandMark />
        <Button asChild size="sm"><Link href="/sign-in"><LogIn aria-hidden="true" />Sign in</Link></Button>
      </div>
    </header>

    <main>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:py-24">
        <div className="space-y-6">
          <Badge variant="secondary">For enrolled students and their instructors</Badge>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{BRAND.tagline}</h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">Each question shows a short piece of code and asks what it does or what it prints. You see one question at a time and can move between them freely.</p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg"><Link href="/sign-in"><LogIn aria-hidden="true" />Sign in</Link></Button>
            <Button asChild size="lg" variant="outline"><a href="#how-it-works">How it works</a></Button>
          </div>
        </div>

        {/* Illustration of the exam screen; decorative, so hidden from assistive technology. */}
        <Card aria-hidden="true" className="pointer-events-none select-none shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between gap-4"><CardTitle className="text-sm">Question 3 of 10</CardTitle><span className="font-mono text-sm font-semibold tabular-nums">12:48</span></div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">What does this log?</p>
            <pre className="overflow-hidden rounded-lg border bg-muted p-3 font-mono text-xs leading-relaxed">{`const marks = [72, 45, 90];
const passed = marks.filter((m) => m >= 60);
console.log(passed.length);`}</pre>
            <div className="space-y-2">
              {["1", "2", "3", "undefined"].map((option, i) => <div key={option} className={`flex items-center gap-3 rounded-lg border p-2.5 text-sm ${i === 1 ? "border-primary bg-accent/40" : ""}`}>
                <span className={`flex size-4 items-center justify-center rounded-full border ${i === 1 ? "border-primary" : "border-foreground/50"}`}>{i === 1 && <span className="size-2 rounded-full bg-primary" />}</span>
                <span className="font-semibold">{"ABCD"[i]}</span><code className="font-mono">{option}</code>
              </div>)}
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><Wifi className="size-3.5" />Saved to server</p>
          </CardContent>
        </Card>
      </section>

      <section id="how-it-works" className="border-y bg-card">
        <div className="mx-auto max-w-6xl space-y-8 px-6 py-16">
          <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
          <ol className="grid gap-6 md:grid-cols-3">
            {steps.map(({ icon: Icon, title, text }, i) => <li key={title}><Card className="h-full"><CardHeader><div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span><Icon aria-hidden="true" className="size-5 text-primary" /></div><CardTitle className="pt-2"><h3>{title}</h3></CardTitle><CardDescription>{text}</CardDescription></CardHeader></Card></li>)}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl space-y-8 px-6 py-16">
        <h2 className="text-3xl font-semibold tracking-tight">During the assessment</h2>
        <ul className="grid gap-6 sm:grid-cols-2">
          {examFacts.map(({ icon: Icon, title, text }) => <li key={title} className="flex gap-4"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary"><Icon aria-hidden="true" className="size-5 text-primary" /></span><div className="space-y-1"><h3 className="font-semibold">{title}</h3><p className="text-sm leading-relaxed text-muted-foreground">{text}</p></div></li>)}
        </ul>
      </section>

      <section className="border-y bg-card">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-2">
          <div className="space-y-4">
            <h2 className="text-3xl font-semibold tracking-tight">Before you start</h2>
            <ul className="space-y-3">{checklist.map((item) => <li key={item} className="flex gap-3"><MonitorCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" /><span>{item}</span></li>)}</ul>
          </div>
          <Card>
            <CardHeader><CardTitle><h2 className="text-xl">For instructors</h2></CardTitle><CardDescription>Instructors use the same sign-in page and go to the admin area.</CardDescription></CardHeader>
            <CardContent>
              <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
                <li>A question bank where each question is reviewed before use and edits are saved as new versions. Questions can have one correct answer or several, and code can appear in the question or the options.</li>
                <li>Assessments built from a plan of topics and difficulty, with more than one question set if you need it and a limit on how many questions the sets share.</li>
                <li>A live view of who has started and submitted. Extensions, voided attempts and retests are recorded in an audit log.</li>
                <li>Class list and question imports, with a preview before anything is saved.</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-3xl space-y-6 px-6 py-16">
        <h2 className="text-3xl font-semibold tracking-tight">Questions</h2>
        <div className="divide-y rounded-lg border bg-card">
          {faqs.map(({ q, a }) => <Collapsible key={q} className="group px-4">
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 py-4 text-left font-medium">{q}<ChevronDown aria-hidden="true" className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" /></CollapsibleTrigger>
            <CollapsibleContent className="pb-4 text-sm leading-relaxed text-muted-foreground">{a}</CollapsibleContent>
          </Collapsible>)}
        </div>
        <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-secondary/40 p-6">
          <p className="flex-1 font-medium">Sign in to see your assessments.</p>
          <Button asChild><Link href="/sign-in"><LogIn aria-hidden="true" />Sign in</Link></Button>
        </div>
      </section>
    </main>

    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground">
        <BrandMark className="text-sm" />
        <p>For questions about an assessment, contact your instructor.</p>
      </div>
    </footer>
  </div>;
}
