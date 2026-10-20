import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth/http";
import { mfaRequired } from "@/server/auth/service";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Logout } from "@/components/auth/logout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export default async function MfaPage() {
  if (!mfaRequired()) redirect("/admin");
  const session = await currentSession(true);
  if (!session) redirect("/sign-in");
  if (!session.user.isAdmin) redirect("/student");
  if (session.mfaVerifiedAt) redirect("/admin/students");
  return <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-6 px-6 py-12"><Card><CardHeader><CardTitle><h1 className="text-2xl font-semibold">Verify admin access</h1></CardTitle><CardDescription>Enter the code from your authenticator app, or one of your unused recovery codes. Complete this within ten minutes of sign-in.</CardDescription></CardHeader><CardContent><SignInForm mfa /></CardContent></Card><Logout /></main>;
}
