import assert from "node:assert/strict";
import { classifySmsKeyword, SMS_STOP_KEYWORDS } from "./smsKeywords";

for (const word of SMS_STOP_KEYWORDS) {
  assert.equal(classifySmsKeyword(word), "stop", word);
  assert.equal(classifySmsKeyword(` ${word.toLowerCase()} `), "stop", word);
}

assert.equal(classifySmsKeyword("HELP"), "help");
assert.equal(classifySmsKeyword("INFO"), "help");
assert.equal(classifySmsKeyword("START"), "start");
assert.equal(classifySmsKeyword("UNSTOP"), "start");
assert.equal(classifySmsKeyword("YES"), "start");
assert.equal(classifySmsKeyword("hello"), "none");
assert.equal(classifySmsKeyword(""), "none");

console.log("smsKeywords.test.ts — PASS");
