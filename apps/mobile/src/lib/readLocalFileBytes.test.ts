import assert from "node:assert/strict";
import {
  evaluateLocalFileReadGuard,
  ReadLocalFileBytesError,
} from "./readLocalFileBytesPure";

const allowed = new Set(["image/jpeg", "image/png", "application/pdf"]);

{
  const g = evaluateLocalFileReadGuard({
    uri: "file:///tmp/a.jpg",
    exists: true,
    byteLength: 120,
    mime: "image/jpeg",
    allowedMimes: allowed,
  });
  assert.equal(g.ok, true);
}

{
  const g = evaluateLocalFileReadGuard({
    uri: "file:///tmp/a.jpg",
    exists: true,
    byteLength: 0,
    mime: "image/jpeg",
    allowedMimes: allowed,
  });
  assert.equal(g.ok, false);
  if (g.ok === false) assert.equal(g.reason, "empty");
}

{
  const g = evaluateLocalFileReadGuard({
    uri: "file:///tmp/a.jpg",
    exists: true,
    byteLength: 12 * 1024 * 1024,
    maxBytes: 10 * 1024 * 1024,
    mime: "image/jpeg",
    allowedMimes: allowed,
  });
  assert.equal(g.ok, false);
  if (g.ok === false) assert.equal(g.reason, "too_large");
}

{
  const g = evaluateLocalFileReadGuard({
    uri: "file:///tmp/a.bin",
    exists: true,
    byteLength: 120,
    mime: "application/octet-stream",
    allowedMimes: allowed,
  });
  assert.equal(g.ok, false);
  if (g.ok === false) assert.equal(g.reason, "bad_mime");
}

{
  const g = evaluateLocalFileReadGuard({
    uri: "file:///tmp/missing.jpg",
    exists: false,
    byteLength: 0,
    mime: "image/jpeg",
  });
  assert.equal(g.ok, false);
  if (g.ok === false) assert.equal(g.reason, "not_found");
}

{
  const g = evaluateLocalFileReadGuard({
    uri: "  ",
    exists: true,
    byteLength: 10,
  });
  assert.equal(g.ok, false);
  if (g.ok === false) assert.equal(g.reason, "missing_uri");
}

{
  const err = new ReadLocalFileBytesError("cancelled", "Local file read was cancelled.");
  assert.equal(err.reason, "cancelled");
  assert.equal(err.name, "ReadLocalFileBytesError");
}

{
  const err = new ReadLocalFileBytesError("read_failed", "Unable to read local file bytes");
  assert.equal(err.reason, "read_failed");
}

console.log("readLocalFileBytes.test.ts — PASS");
