import assert from "node:assert/strict";
import { isAuthorizedCronRequest, isProductionRuntime } from "./cronAuth";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

function fakeReq(headers: Record<string, string>): Request {
  return new Request("https://example.com/cron", { headers });
}

const env = process.env as Record<string, string | undefined>;
const prevCron = env.CRON_SECRET;
const prevNode = env.NODE_ENV;
const prevVercel = env.VERCEL_ENV;

try {
  env.CRON_SECRET = "super-secret-cron";
  env.NODE_ENV = "production";
  delete env.VERCEL_ENV;

  test("cron auth rejects x-vercel-cron alone in production", () => {
    assert.equal(isAuthorizedCronRequest(fakeReq({ "x-vercel-cron": "1" })), false);
  });

  test("cron auth accepts bearer CRON_SECRET", () => {
    assert.equal(
      isAuthorizedCronRequest(fakeReq({ authorization: "Bearer super-secret-cron" })),
      true
    );
  });

  test("cron auth accepts x-cron-secret", () => {
    assert.equal(
      isAuthorizedCronRequest(fakeReq({ "x-cron-secret": "super-secret-cron" })),
      true
    );
  });

  test("cron auth rejects wrong secret", () => {
    assert.equal(
      isAuthorizedCronRequest(fakeReq({ "x-cron-secret": "wrong" })),
      false
    );
  });

  test("isProductionRuntime true when NODE_ENV=production", () => {
    assert.equal(isProductionRuntime(), true);
  });
} finally {
  if (prevCron == null) delete env.CRON_SECRET;
  else env.CRON_SECRET = prevCron;
  if (prevNode == null) delete env.NODE_ENV;
  else env.NODE_ENV = prevNode;
  if (prevVercel == null) delete env.VERCEL_ENV;
  else env.VERCEL_ENV = prevVercel;
}

console.log("cronAuth tests passed");
