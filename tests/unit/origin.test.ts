import { test } from "node:test";
import assert from "node:assert/strict";
import { loopbackAlias } from "../../src/server/auth/origin";

test("development accepts loopback aliases on the same port only", () => {
  const app = "http://127.0.0.1:3000";
  for (const origin of ["http://localhost:3000", "http://[::1]:3000"]) assert.equal(loopbackAlias(origin, app, false), true, origin);
  for (const origin of ["http://localhost:4000", "https://localhost:3000", "http://evil.test:3000", "null", null]) assert.equal(loopbackAlias(origin, app, false), false, String(origin));
  assert.equal(loopbackAlias("http://localhost:3000", "https://grading.example.org", false), false, "a real domain never has aliases");
});
test("production never accepts aliases", () => {
  assert.equal(loopbackAlias("http://localhost:3000", "http://127.0.0.1:3000", true), false);
});
