"use client";
import type { Mutation } from "@/shared/attempts";

/**
 * Answers kept on this device until the server acknowledges them (specification §6).
 * One record per attempt question holds its latest unacknowledged change. Every call fails
 * soft: if the browser cannot store data the exam continues with server saves only.
 */
export type Queued = { key: string; attemptId: string; mutation: Mutation; queuedAt: string };
const DB = "tracebench", STORE = "pending", VERSION = 1;
/** Stale device content is removed after seven days. */
const MAX_AGE_MS = 7 * 24 * 3600_000;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("unavailable"));
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => { const store = request.result.createObjectStore(STORE, { keyPath: "key" }); store.createIndex("attemptId", "attemptId"); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
const keyOf = (attemptId: string, attemptQuestionId: string) => `${attemptId}:${attemptQuestionId}`;

/** Resolves true once the change is on this device; false if local storage is unavailable. */
export async function keep(attemptId: string, mutation: Mutation): Promise<boolean> {
  try { await run("readwrite", (s) => s.put({ key: keyOf(attemptId, mutation.attemptQuestionId), attemptId, mutation, queuedAt: new Date().toISOString() } satisfies Queued)); return true; }
  catch { return false; }
}
/** Removes a change once acknowledged, unless a newer one for the same question replaced it. */
export async function settle(attemptId: string, attemptQuestionId: string, clientMutationId: string) {
  try {
    await run("readwrite", (s) => {
      const request = s.get(keyOf(attemptId, attemptQuestionId));
      request.onsuccess = () => { const record = request.result as Queued | undefined; if (record?.mutation.clientMutationId === clientMutationId) s.delete(record.key); };
    });
  } catch { /* nothing kept locally */ }
}
/** This attempt's surviving changes; also drops anything older than seven days on this device. */
export async function load(attemptId: string): Promise<Queued[]> {
  try {
    const all = (await run<Queued[]>("readonly", (s) => s.getAll())) ?? [];
    const cutoff = Date.now() - MAX_AGE_MS;
    const stale = all.filter((r) => Date.parse(r.queuedAt) < cutoff);
    if (stale.length) await run("readwrite", (s) => { for (const r of stale) s.delete(r.key); });
    return all.filter((r) => r.attemptId === attemptId && Date.parse(r.queuedAt) >= cutoff);
  } catch { return []; }
}
/** Clears this attempt's device content after submission, expiry or evidence upload. */
export async function clear(attemptId: string, keys?: string[]) {
  try {
    const records = await load(attemptId);
    await run("readwrite", (s) => { for (const r of records) if (!keys || keys.includes(r.key)) s.delete(r.key); });
  } catch { /* nothing kept locally */ }
}
