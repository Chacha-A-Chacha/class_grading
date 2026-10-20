import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function secret(name: string): string {
  const value = process.env[name];
  if (!value || value.length < 32) throw new Error(`${name} must contain at least 32 random characters.`);
  return value;
}
export const token = () => randomBytes(32).toString("base64url");
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const verifier = (purpose: string, value: string) => createHmac("sha256", secret("AUTH_CODE_SECRET")).update(`${purpose}:${value}`).digest("hex");
export function equal(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export function encrypt(value: string): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(hash(secret("AUTH_MFA_SECRET")), "hex"), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return new Uint8Array(Buffer.concat([iv, cipher.getAuthTag(), encrypted]));
}
export function decrypt(value: Uint8Array): string {
  const data = Buffer.from(value);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(hash(secret("AUTH_MFA_SECRET")), "hex"), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}
