import Link from "next/link";
import { ChevronDown, ClipboardCheck, Clock, Laptop, ListChecks, LogIn, Mail, MonitorCheck, Save, Shuffle, Wifi } from "lucide-react";
import { BRAND } from "@/shared/brand";
import { BrandMark } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const steps = [
  { icon: ClipboardCheck, title: "Your instructor assigns it", text: "You are enrolled by your instructor and see each assessment on your dashboard, with its opening time and duration." },
  { icon: Mail, title: "Sign in with an emailed code", text: "No password. Enter the email your instructor registered and type the six-digit code we send you." },
  { icon: ListChecks, title: "Answer, then submit", text: "Work through the questions in any order. Every answer is saved as you go, and you get a receipt when you submit." },
];
const fairness = [
  { icon: Clock, title: "One clock for everyone", text: "The timer starts when you press Start and the server keeps the time, so a slow device or a changed clock never costs or gains anyone a minute." },
  { icon: Save, title: "Saved as you go", text: "Each answer is sent to the server straight away. The screen shows when it is saved, and keeps retrying if your connection drops." },
  { icon: Shuffle, title: "Balanced question sets", text: "Questions come from balanced sets chosen by your instructor, and options are shuffled for each person, so neighbouring screens rarely match." },
  { icon: Laptop, title: "Built for reading code", text: "Code is shown exactly as written, with scrolling for long lines. A laptop is best for code-heavy papers; phones are supported." },
];
const checklist = [
  "Find a quiet place and a charged laptop if you can.",
  "Check you can open your email on another tab or device.",
  "Read the rules page before you press Start: the timer begins then.",
  "Answer every question. An unanswered question scores zero; a wrong answer costs nothing extra.",
];
const faqs = [
  { q: "Do I need a password?", a: "No. Each time you sign in, we email a six-digit code to your registered address. It works for two minutes, in the browser where you asked for it." },
  { q: "What if my internet drops during an assessment?", a: "Keep the page open. Answers you choose are kept on screen and sent again when you reconnect; the status shows whether each one has reached the server. The timer does not pause, and only answers the server receives before your deadline count." },
  { q: "Can I go back and change an answer?", a: "Yes, until you submit or time runs out. You can move freely between questions and mark any of them to review before submitting." },
  { q: "When will I see my results?", a: "After every student's answering window has closed and your instructor releases results. You will then see your score, with explanations where your instructor shares them." },
  { q: "Who can sign in?", a: "Only students your instructor has enrolled, and instructors. If a code does not arrive, check your spam folder or ask your instructor to confirm your registered email." },
];

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
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Show how well you can read code and reason about what it does.</h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">{BRAND.name} runs your class&apos;s timed assessments: real code to trace, one question on screen at a time, every answer saved as you go, and the same clock for everyone.</p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg"><Link href="/sign-in"><LogIn aria-hidden="true" />Sign in</Link></Button>
            <Button asChild size="lg" variant="outline"><a href="#how-it-works">How it works</a></Button>
          </div>
          <p className="text-sm text-muted-foreground">No password needed. You sign in with a code sent to the email your instructor registered.</p>
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
          <div className="max-w-2xl space-y-2"><h2 className="text-3xl font-semibold tracking-tight">How it works</h2><p className="text-muted-foreground">Three steps, from enrolment to your receipt.</p></div>
          <ol className="grid gap-6 md:grid-cols-3">
            {steps.map(({ icon: Icon, title, text }, i) => <li key={title}><Card className="h-full"><CardHeader><div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span><Icon aria-hidden="true" className="size-5 text-primary" /></div><CardTitle className="pt-2"><h3>{title}</h3></CardTitle><CardDescription>{text}</CardDescription></CardHeader></Card></li>)}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl space-y-8 px-6 py-16">
        <div className="max-w-2xl space-y-2"><h2 className="text-3xl font-semibold tracking-tight">Fair by design</h2><p className="text-muted-foreground">An assessment should measure what you understand, not how fast your connection is.</p></div>
        <ul className="grid gap-6 sm:grid-cols-2">
          {fairness.map(({ icon: Icon, title, text }) => <li key={title} className="flex gap-4"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary"><Icon aria-hidden="true" className="size-5 text-primary" /></span><div className="space-y-1"><h3 className="font-semibold">{title}</h3><p className="text-sm leading-relaxed text-muted-foreground">{text}</p></div></li>)}
        </ul>
      </section>

      <section className="border-y bg-card">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-2">
          <div className="space-y-4">
            <h2 className="text-3xl font-semibold tracking-tight">Before you start</h2>
            <ul className="space-y-3">{checklist.map((item) => <li key={item} className="flex gap-3"><MonitorCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" /><span>{item}</span></li>)}</ul>
          </div>
          <Card>
            <CardHeader><CardTitle><h2 className="text-xl">For instructors</h2></CardTitle><CardDescription>Sign in from the same page. Your account opens the admin workspace.</CardDescription></CardHeader>
            <CardContent>
              <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
                <li>A question bank with reviewed, versioned questions: single answer or select all that apply, with code in prompts and options.</li>
                <li>Assessments built from blueprints, with parallel sets that share no more than the overlap you allow.</li>
                <li>Live monitoring during the sitting, and audited extensions, voids and retests.</li>
                <li>Roster and question imports with a preview before anything is saved.</li>
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
          <p className="flex-1 font-medium">Ready when your instructor opens an assessment.</p>
          <Button asChild><Link href="/sign-in"><LogIn aria-hidden="true" />Sign in</Link></Button>
        </div>
      </section>
    </main>

    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground">
        <BrandMark className="text-sm" />
        <p>{BRAND.tagline} Questions about an assessment? Contact your instructor.</p>
      </div>
    </footer>
  </div>;
}
