import { CodeXml, Mail } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center gap-8 px-6 py-16 sm:py-24">
      <p className="flex items-center gap-2 text-sm font-semibold text-primary">
        <CodeXml aria-hidden="true" className="size-5" />
        Code Logic Assessments
      </p>
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        A place to put your programming knowledge into practice.
      </h1>
      <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
        Take assigned assessments, review your answers, and follow your progress.
        Access will use a one-time code sent to your registered email.
      </p>
      <Card className="mt-2">
        <CardHeader className="gap-3">
          <Badge variant="secondary">Class portal</Badge>
          <CardTitle><h2>Your assessment portal</h2></CardTitle>
        </CardHeader>
        <CardContent>
          <p id="access-notice" className="leading-relaxed text-muted-foreground">
            Sign in with your registered email. Your instructor will share
            assessment details when exams are ready.
          </p>
        </CardContent>
        <CardFooter>
          <Button asChild aria-describedby="access-notice">
            <Link href="/sign-in"><Mail aria-hidden="true" />Sign in</Link>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
