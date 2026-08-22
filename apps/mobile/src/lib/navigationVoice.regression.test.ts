import {
  canSpeakInstructionKey,
  recordInstructionKeySpoken,
  resetNavigationVoiceLedger,
} from "./navigationVoiceLedger";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

resetNavigationVoiceLedger();
const key = "maneuver-1:500";

assert(canSpeakInstructionKey(key), "first speak allowed");
recordInstructionKeySpoken(key);
assert(canSpeakInstructionKey(key), "second speak allowed");
recordInstructionKeySpoken(key);
assert(!canSpeakInstructionKey(key), "third speak blocked");

resetNavigationVoiceLedger();
assert(canSpeakInstructionKey(key), "counter resets on reroute ledger reset");

console.log("navigationVoice.regression.test.ts — PASS");
