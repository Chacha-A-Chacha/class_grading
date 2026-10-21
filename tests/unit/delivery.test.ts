import { test } from "node:test";
import assert from "node:assert/strict";
import { failedOutcome, redact, sentOutcome } from "../../src/server/auth/delivery";

test("delivery log text never keeps addresses or six-digit codes", () => {
  assert.equal(redact("550 5.1.1 <student@example.test>: Recipient address rejected"), "550 5.1.1 <[address]>: Recipient address rejected");
  assert.equal(redact("Your sign-in code is 042917."), "Your sign-in code is [code].");
  // Queue ids contain long digit runs that are not codes.
  assert.equal(redact("250 OK id=1xJV6X-0000000HAce-1gor"), "250 OK id=1xJV6X-0000000HAce-1gor");
  assert.equal(redact("x".repeat(400)).length, 300);
});

test("accepted mail records the server reply and its SMTP code", () => {
  assert.deepEqual(sentOutcome("250 OK id=1xJV6X-0000000HAce-1gor"), { status: "SENT", smtpCode: 250, errorCode: null, stage: null, detail: "250 OK id=1xJV6X-0000000HAce-1gor" });
  assert.deepEqual(sentOutcome(undefined), { status: "SENT", smtpCode: null, errorCode: null, stage: null, detail: null });
});

test("failed mail keeps the nodemailer code, stage and redacted reply", () => {
  const rejected = Object.assign(new Error("Can't send mail"), { code: "EENVELOPE", command: "RCPT TO", responseCode: 550, response: "550 5.1.1 <student@example.test>: Recipient address rejected" });
  assert.deepEqual(failedOutcome(rejected), { status: "FAILED", smtpCode: 550, errorCode: "EENVELOPE", stage: "RCPT TO", detail: "550 5.1.1 <[address]>: Recipient address rejected" });
  const timeout = Object.assign(new Error("Greeting never received"), { code: "ETIMEDOUT", command: "CONN" });
  assert.deepEqual(failedOutcome(timeout), { status: "FAILED", smtpCode: null, errorCode: "ETIMEDOUT", stage: "CONN", detail: "Greeting never received" });
  assert.deepEqual(failedOutcome("boom"), { status: "FAILED", smtpCode: null, errorCode: null, stage: null, detail: null });
});
