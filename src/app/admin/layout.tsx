import Link from "next/link";
import { adminPage } from "@/server/auth/http";
import { Logout } from "@/components/auth/logout";

export const dynamic = "force-dynamic";
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await adminPage();
  return <div className="min-h-svh"><header className="border-b bg-card"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5"><Link href="/admin" className="font-semibold text-primary">Code Logic · Admin</Link><div className="flex items-center gap-4"><span className="text-sm text-muted-foreground">{session.user.displayName}</span><Logout /></div></div><nav aria-label="Admin" className="mx-auto flex max-w-6xl gap-6 px-6 pb-4 text-sm"><Link href="/admin" className="hover:underline">Overview</Link><Link href="/admin/students" className="hover:underline">Students</Link><Link href="/admin/questions" className="hover:underline">Question bank</Link></nav></header><main className="mx-auto max-w-6xl px-6 py-8">{children}</main></div>;
}
