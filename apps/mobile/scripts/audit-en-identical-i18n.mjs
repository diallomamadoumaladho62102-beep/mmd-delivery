#!/usr/bin/env node
/**
 * Audits locale JSON against English using the same merge order as src/i18n/resources.ts, so what
 * is measured is what the app actually renders.
 *
 * Reports, per locale:
 *  - identical: effective value is still the English string (untranslated)
 *  - french:    effective value is the French string in a non-French locale
 *  - latin:     Arabic/Chinese value still contains Latin words (mixed-script hybrid)
 *  - english:   French/Spanish/Fulfulde value still contains English words
 *  - missing:   key exists in English but in neither locale file (falls back to English)
 *  - keepers:   identical on purpose (brands, acronyms, units)
 *
 * Usage:
 *   node scripts/audit-en-identical-i18n.mjs
 *   node scripts/audit-en-identical-i18n.mjs --list fr [--priority]
 */
import {
  LOCALES,
  hasLetters,
  hasStrayEnglish,
  hasStrayLatin,
  isFrenchLeak,
  isIntentional,
  isPriority,
  merged,
} from './i18n-shared.mjs';

const listLocale = process.argv.includes('--list')
  ? process.argv[process.argv.indexOf('--list') + 1]
  : null;
const priorityOnly = process.argv.includes('--priority');

const en = merged('en');
const fr = merged('fr');
const rows = [];

for (const locale of LOCALES) {
  const loc = merged(locale);
  const found = { identical: [], french: [], latin: [], english: [], missing: [], keepers: [] };

  for (const [key, enVal] of Object.entries(en)) {
    const value = loc[key];
    if (value === undefined) found.missing.push({ key, enVal });
    else if (hasLetters(enVal) && value === enVal) {
      found[isIntentional(enVal, locale) ? 'keepers' : 'identical'].push({ key, enVal });
    } else if (isFrenchLeak(value, enVal, fr[key], locale)) found.french.push({ key, enVal, value });
    else if (hasStrayLatin(value, locale)) found.latin.push({ key, enVal, value });
    else if (hasStrayEnglish(value, enVal, locale)) found.english.push({ key, enVal, value });
  }
  rows.push({ locale, ...found });

  if (listLocale === locale) {
    const keep = (list) => (priorityOnly ? list.filter((r) => isPriority(r.key)) : list);
    for (const r of keep(found.identical)) console.log(`IDENTICAL ${locale} ${r.key} :: ${r.enVal}`);
    for (const r of keep(found.french)) console.log(`FRENCH    ${locale} ${r.key} :: ${r.value}`);
    for (const r of keep(found.latin)) console.log(`LATIN     ${locale} ${r.key} :: ${r.value}`);
    for (const r of keep(found.english)) console.log(`ENGLISH   ${locale} ${r.key} :: ${r.value}`);
    for (const r of keep(found.missing)) console.log(`MISSING   ${locale} ${r.key} :: ${r.enVal}`);
  }
}

const header = [
  'locale',
  'identical(prio)',
  'identical',
  'french',
  'latin',
  'english',
  'missing',
  'keepers',
];
console.log(`\n${header.join(' | ')}`);
for (const row of rows) {
  const cells = [
    row.locale.padEnd(6),
    String(row.identical.filter((r) => isPriority(r.key)).length).padStart(15),
    String(row.identical.length).padStart(9),
    String(row.french.length).padStart(6),
    String(row.latin.length).padStart(5),
    String(row.english.length).padStart(7),
    String(row.missing.length).padStart(7),
    String(row.keepers.length).padStart(7),
  ];
  console.log(cells.join(' | '));
}
