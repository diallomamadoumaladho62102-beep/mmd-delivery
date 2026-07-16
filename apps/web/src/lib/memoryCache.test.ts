import assert from "node:assert/strict";
import {
  cacheClearForTests,
  cacheGet,
  cacheSet,
  cacheSizeForTests,
  cacheWrap,
} from "./memoryCache";

async function main() {
  cacheClearForTests();
  assert.equal(cacheGet("missing"), null);

  cacheSet("a", { ok: true }, 60_000);
  assert.deepEqual(cacheGet("a"), { ok: true });
  assert.equal(cacheSizeForTests(), 1);

  cacheSet("expire-soon", 1, 1);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(cacheGet("expire-soon"), null);

  let produced = 0;
  const v1 = await cacheWrap("wrap", 60_000, async () => {
    produced += 1;
    return "once";
  });
  const v2 = await cacheWrap("wrap", 60_000, async () => {
    produced += 1;
    return "twice";
  });
  assert.equal(v1, "once");
  assert.equal(v2, "once");
  assert.equal(produced, 1);

  cacheClearForTests();
  console.log("memoryCache tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
