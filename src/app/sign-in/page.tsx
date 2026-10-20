import Link from "next/link";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function SignInPage() {
  return <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-6 px-6 py-12"><Link className="text-sm font-semibold text-primary" href="/">Code Logic Assessments</Link><Card><CardHeader><CardTitle><h1>Sign in</h1></CardTitle><CardDescription>Use a code sent to your registered email. No password needed.</CardDescription></CardHeader><CardContent><SignInForm /></CardContent></Card></main>;
}
