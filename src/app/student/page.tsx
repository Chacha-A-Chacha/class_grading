import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth/http";
import { Logout } from "@/components/auth/logout";

export const dynamic = "force-dynamic";
export default async function StudentPage() {
  const session = await currentSession(true);
  if (!session) redirect("/sign-in");
  if (session.user.isAdmin) redirect("/admin");
  return <main className="mx-auto max-w-3xl space-y-6 px-6 py-16"><h1 className="text-3xl font-semibold">Welcome, {session.user.displayName}</h1><p className="text-muted-foreground">You are signed in. The assessment dashboard is being prepared. Your instructor will share details when assessments are available.</p><Logout /></main>;
}
