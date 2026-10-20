import { notFound } from "next/navigation";
import { z } from "zod";
import { studentPage } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { getAttemptView } from "@/server/attempts/service";
import { AppError } from "@/server/errors";
import { ExamClient } from "@/components/student/exam-client";

export default async function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await studentPage();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  // Ownership is checked in the service; another student's attempt is simply not found (A08).
  const view = await getAttemptView(getDatabase(), session.userId, id).catch((error: unknown) => { if (error instanceof AppError && error.status === 404) notFound(); throw error; });
  return <ExamClient initial={view} />;
}
