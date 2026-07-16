import assert from "node:assert/strict";
import {
  isAllowedMime,
  isSafeStoragePathSegment,
  resolveLocationPhotoContent,
  resolveSafetyRecordingUpload,
  sniffImageMime,
  validateIdentitySelfiePath,
} from "./uploadSecurity";

function jpegBuffer(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
}

function pngBuffer(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

assert.equal(sniffImageMime(jpegBuffer())?.mime, "image/jpeg");
assert.equal(sniffImageMime(pngBuffer())?.mime, "image/png");
assert.equal(sniffImageMime(Buffer.from([0x00, 0x01])), null);

const okPhoto = resolveLocationPhotoContent({
  claimedMime: "image/jpeg",
  buffer: jpegBuffer(),
});
assert.equal(okPhoto.ok, true);

const svgRejected = resolveLocationPhotoContent({
  claimedMime: "image/svg+xml",
  buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
});
assert.equal(svgRejected.ok, false);

const mismatch = resolveLocationPhotoContent({
  claimedMime: "image/png",
  buffer: jpegBuffer(),
});
assert.equal(mismatch.ok, false);

assert.equal(isAllowedMime("audio/mp4", ["audio/mp4", "video/mp4"]), true);
assert.equal(isAllowedMime("image/svg+xml", ["image/jpeg"]), false);

const safetyOk = resolveSafetyRecordingUpload({
  rideId: "11111111-1111-1111-1111-111111111111",
  recordingId: "22222222-2222-2222-2222-222222222222",
  mimeType: "audio/mp4",
  extension: "m4a",
  fileSizeBytes: 1024,
  clientPath: null,
});
assert.equal(safetyOk.ok, true);
if (safetyOk.ok) {
  assert.match(
    safetyOk.storagePath,
    /^11111111-1111-1111-1111-111111111111\/22222222-2222-2222-2222-222222222222\//
  );
}

const safetyBadPath = resolveSafetyRecordingUpload({
  rideId: "11111111-1111-1111-1111-111111111111",
  recordingId: "22222222-2222-2222-2222-222222222222",
  mimeType: "audio/mp4",
  fileSizeBytes: 1024,
  clientPath: "../evil/path.m4a",
});
assert.equal(safetyBadPath.ok, false);

const safetyBadMime = resolveSafetyRecordingUpload({
  rideId: "11111111-1111-1111-1111-111111111111",
  recordingId: "22222222-2222-2222-2222-222222222222",
  mimeType: "application/octet-stream",
  fileSizeBytes: 1024,
});
assert.equal(safetyBadMime.ok, false);

assert.equal(isSafeStoragePathSegment("abc-123"), true);
assert.equal(isSafeStoragePathSegment("../x"), false);

const selfieOk = validateIdentitySelfiePath({
  userId: "user-1",
  path: "drivers/user-1/check/selfie.jpg",
});
assert.equal(selfieOk.ok, true);

const selfieBad = validateIdentitySelfiePath({
  userId: "user-1",
  path: "drivers/other/check/selfie.jpg",
});
assert.equal(selfieBad.ok, false);

console.log("uploadSecurity tests passed");
