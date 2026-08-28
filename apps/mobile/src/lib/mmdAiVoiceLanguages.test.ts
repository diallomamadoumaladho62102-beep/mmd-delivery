import assert from "node:assert/strict";
import {
  normalizeAppLocale,
  pickAvailableTtsLanguage,
  resolveAiVoiceLanguages,
} from "./mmdAiVoiceLanguages";

assert.equal(normalizeAppLocale("fr-FR"), "fr");
assert.equal(normalizeAppLocale("de-DE"), "en");
assert.equal(normalizeAppLocale("ff"), "ff");

const en = resolveAiVoiceLanguages("en");
assert.equal(en.ttsLanguage, "en-US");
assert.equal(en.sttLanguage, "en");
assert.equal(en.ttsFallback, false);

const fr = resolveAiVoiceLanguages("fr");
assert.equal(fr.ttsLanguage, "fr-FR");
assert.equal(fr.sttLanguage, "fr");

const es = resolveAiVoiceLanguages("es");
assert.equal(es.sttLanguage, "es");
const ar = resolveAiVoiceLanguages("ar");
assert.equal(ar.sttLanguage, "ar");
const zh = resolveAiVoiceLanguages("zh");
assert.equal(zh.sttLanguage, "zh");

const ff = resolveAiVoiceLanguages("ff");
assert.equal(ff.sttLanguage, null);
assert.equal(ff.ttsLanguage, "en-US");
assert.equal(ff.ttsFallback, true);
assert.equal(ff.sttFallback, true);

const picked = pickAvailableTtsLanguage("ar-SA", ["en-US", "fr-FR"]);
assert.equal(picked.language, "en-US");
assert.equal(picked.usedFallback, true);

const native = pickAvailableTtsLanguage("fr-FR", ["fr-FR", "en-US"]);
assert.equal(native.language, "fr-FR");
assert.equal(native.usedFallback, false);

console.log("mmdAiVoiceLanguages.test.ts OK");
