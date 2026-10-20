import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { type ImportRow, type ImportResult, type StudentIdentity, studentSchema } from "../../shared/students";
import { accountScopes, assertAdmin, now } from "../auth/service";
import { verifier } from "../auth/crypto";
import { AppError } from "../errors";

export async function classify(tx: Prisma.TransactionClient, rows: ImportRow[]) {
  const users = await tx.user.findMany({ where: { OR: [{ email: { in: rows.map((r) => r.email) } }, { admissionNumber: { in: rows.flatMap((r) => r.admissionNumber ? [r.admissionNumber] : []), mode: "insensitive" } }] } });
  return rows.map((source) => {
    const row = { ...source, errors: [...source.errors] };
    if (row.errors.length) return row;
    const matches = users.filter((user) => user.email === row.email || (row.admissionNumber && user.admissionNumber?.trim().toUpperCase() === row.admissionNumber));
    if (matches.length === 1 && !matches[0].isAdmin && !matches[0].disabledAt && matches[0].email === row.email && matches[0].admissionNumber === row.admissionNumber && matches[0].displayName === row.displayName) row.action = "existing";
    else if (matches.length) { row.action = "conflict"; row.errors.push("An existing account matches but differs, is disabled, or is the owner. Resolve it separately."); }
    else row.action = "create";
    return row;
  });
}
/** Workbook parsing is synchronous CPU work; keep it away from live exam traffic. */
export async function assertNoActiveAttempts(db: PrismaClient) {
  if (await db.attempt.count({ where: { status: "ACTIVE" } })) throw new AppError("EXAM_IN_PROGRESS", "Imports are paused while an assessment attempt is active. Try again after it ends.", 409);
}
export async function createPreview(db: PrismaClient, sessionId: string, input: ImportRow[]) {
  if (!input.length || input.length > 1000) throw new AppError("EMPTY_IMPORT", "Choose between 1 and 1,000 student rows.");
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const time = await now(tx);
    // Clear expired identity payloads opportunistically, retaining only receipts.
    await tx.studentImport.updateMany({ where: { expiresAt: { lt: time }, rows: { not: PrismaJsonNull() } }, data: { rows: PrismaJsonNull() } });
    const rows = await classify(tx, input);
    const batch = await tx.studentImport.create({ data: { actorId: admin.userId, rows: rows as unknown as Prisma.InputJsonValue, selection: [], expiresAt: new Date(time.getTime() + 30 * 60_000) } });
    return { id: batch.id, expiresAt: batch.expiresAt.toISOString(), rows };
  });
}

// Runtime Prisma null sentinel is imported separately from its generated types.
import { Prisma as RuntimePrisma } from "../../generated/prisma/client";
const PrismaJsonNull = () => RuntimePrisma.DbNull;

export async function commitImport(db: PrismaClient, sessionId: string, id: string, selected: number[]): Promise<ImportResult> {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${admin.userId}::uuid FOR NO KEY UPDATE`;
    await assertAdmin(tx, sessionId);
    await tx.$queryRaw`SELECT id FROM "StudentImport" WHERE id = ${id}::uuid FOR UPDATE`;
    const batch = await tx.studentImport.findUnique({ where: { id } });
    if (!batch || batch.actorId !== admin.userId) throw new AppError("NOT_FOUND", "Import preview not found.", 404);
    const selection = [...new Set(selected)].sort((a, b) => a - b);
    if (batch.committedAt) {
      if (JSON.stringify(selection) !== JSON.stringify(batch.selection)) throw new AppError("CONFLICT", "This preview was already committed with a different selection.", 409);
      return batch.result as unknown as ImportResult;
    }
    if (!selection.length || batch.expiresAt <= await now(tx) || !Array.isArray(batch.rows)) throw new AppError("EXPIRED_PREVIEW", "The preview is empty or expired. Upload the file again.", 409);
    const rows = batch.rows as unknown as ImportRow[];
    if (selection.some((number) => !rows.some((row) => row.row === number && row.action !== "conflict"))) throw new AppError("INVALID_SELECTION", "Only valid preview rows can be imported.");
    const checked = await classify(tx, rows.filter((r) => selection.includes(r.row)));
    if (checked.some((r) => r.action === "conflict")) throw new AppError("ROSTER_CHANGED", "The roster changed since preview. Upload again to review the conflicts.", 409);
    const createdRows = checked.filter((r) => r.action === "create");
    const created = await tx.user.createManyAndReturn({ data: createdRows.map((r) => studentSchema.parse({ ...r, admissionNumber: r.admissionNumber ?? "" })), select: { id: true } });
    const rejected = rows.filter((r) => r.action === "conflict").length;
    const result = { created: created.length, existing: checked.length - created.length, excluded: rows.length - selection.length - rejected, rejected };
    await tx.studentImport.update({ where: { id }, data: { committedAt: await now(tx), rows: RuntimePrisma.DbNull, selection, result } });
    await tx.auditLog.create({ data: { actorId: admin.userId, action: "STUDENTS_IMPORTED", targetType: "StudentImport", targetId: id, reason: "Owner confirmed the validated student import preview.", metadata: { ...result, createdIds: created.map((r) => r.id) } } });
    return result;
  }, { timeout: 15_000 });
}
export async function addStudent(db: PrismaClient, sessionId: string, identity: StudentIdentity) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${admin.userId}::uuid FOR NO KEY UPDATE`;
    const student = await tx.user.create({ data: identity });
    await tx.auditLog.create({ data: { actorId: admin.userId, action: "STUDENT_CREATED", targetType: "User", targetId: student.id, reason: "Owner manually enrolled a student." } });
    return student;
  });
}
export async function setStudentStatus(db: PrismaClient, sessionId: string, id: string, disabled: boolean, reason: string) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id}::uuid FOR UPDATE`;
    const student = await tx.user.findUnique({ where: { id } });
    if (!student || student.isAdmin) throw new AppError("NOT_FOUND", "Student not found.", 404);
    if (!!student.disabledAt === disabled) throw new AppError("NO_CHANGE", `This student is already ${disabled ? "disabled" : "enabled"}. Refresh the page.`, 409);
    const time = await now(tx);
    await tx.user.update({ where: { id }, data: { disabledAt: disabled ? time : null } });
    if (disabled) {
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: time } });
      await tx.emailLoginChallenge.updateMany({ where: { userId: id, consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: time } });
    }
    await tx.auditLog.create({ data: { actorId: admin.userId, action: disabled ? "STUDENT_DISABLED" : "STUDENT_REACTIVATED", targetType: "User", targetId: id, reason } });
  });
}
export async function resetSignInLimits(db: PrismaClient, sessionId: string, id: string, reason: string) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const student = await tx.user.findUnique({ where: { id } });
    if (!student || student.isAdmin) throw new AppError("NOT_FOUND", "Student not found.", 404);
    const { count } = await tx.authRateLimitBucket.deleteMany({ where: { scope: { in: accountScopes }, subjectHash: verifier("email", student.email) } });
    await tx.auditLog.create({ data: { actorId: admin.userId, action: "STUDENT_SIGN_IN_LIMITS_RESET", targetType: "User", targetId: id, reason, metadata: { buckets: count } } });
    return count;
  });
}
