import { getDatabase } from "@/server/db";
import { endpoint, json } from "@/server/http";
import { authCookie, saveAuthCookie } from "@/server/auth/http";
import { hash } from "@/server/auth/crypto";

export const POST = endpoint(async () => {
  const cookie = await authCookie();
  if (cookie.token) await getDatabase().session.updateMany({ where: { tokenHash: hash(cookie.token), revokedAt: null }, data: { revokedAt: new Date() } });
  await saveAuthCookie({});
  return json({ redirect: "/sign-in" });
});
