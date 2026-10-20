import Link from "next/link";
import { studentPage } from "@/server/auth/http";
import { Logout } from "@/components/auth/logout";

export const dynamic = "force-dynamic";
export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await studentPage();
  return <div className="min-h-svh"><header className="border-b bg-card"><div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4"><Link href="/student" className="font-semibold text-primary">Code Logic Assessments</Link><div className="flex items-center gap-4"><span className="text-sm text-muted-foreground">{session.user.displayName}</span><Logout /></div></div></header><main className="mx-auto max-w-5xl px-6 py-8">{children}</main></div>;
}
