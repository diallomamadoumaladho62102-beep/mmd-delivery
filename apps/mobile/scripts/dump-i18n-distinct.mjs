#!/usr/bin/env node
/**
 * Prints the distinct English strings that at least one locale still does not translate (English
 * left as is, French leaked in, or an Arabic/Chinese value with Latin words in it).
 * One line per string: <json string>\t<locales needing it>\t<occurrences + sample key>
 *
 * Feed the output into the TRANSLATIONS map of translate-alert-i18n-keys.mjs.
 */
import {
  LOCALES,
  hasLetters,
  isIntentional,
  merged,
  needsTranslation,
} from './i18n-shared.mjs';

const en = merged('en');
const fr = merged('fr');
const locs = Object.fromEntries(LOCALES.map((l) => [l, merged(l)]));

const vals = new Map();
for (const [key, enVal] of Object.entries(en)) {
  if (!hasLetters(enVal)) continue;
  const need = LOCALES.filter(
    (locale) =>
      needsTranslation({ value: locs[locale][key], enValue: enVal, frValue: fr[key], locale }) &&
      !isIntentional(enVal, locale),
  );
  if (!need.length) continue;
  if (!vals.has(enVal)) vals.set(enVal, { need: new Set(), keys: [] });
  const entry = vals.get(enVal);
  need.forEach((l) => entry.need.add(l));
  entry.keys.push(key);
}

const out = [...vals.entries()].sort((a, b) => a[0].localeCompare(b[0]));
for (const [value, entry] of out) {
  console.log(
    `${JSON.stringify(value)}\t[${[...entry.need].join(',')}]\t${entry.keys.length}x ${entry.keys[0]}`,
  );
}
console.log(`\ndistinct ${out.length}`);
