import Link from "next/link";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function SignInPage() {
  return <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-6 px-6 py-12"><Link className="text-sm font-semibold text-primary" href="/">Code Logic Assessments</Link><Card><CardHeader><CardTitle><h1 className="text-2xl font-semibold">Sign in</h1></CardTitle><CardDescription>No password needed: we email you a one-time code.</CardDescription></CardHeader><CardContent><SignInForm /></CardContent></Card></main>;
}
