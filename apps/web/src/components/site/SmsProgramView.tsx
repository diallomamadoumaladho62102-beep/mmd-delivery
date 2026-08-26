"use client";

import { useState } from "react";
import SmsOptInForm, { SmsProgramLocaleToggle } from "./SmsOptInForm";
import { SMS_LEGAL_LINKS, SMS_PROGRAM_COPY, type SmsProgramLocale } from "./smsProgramCopy";
import { siteContainerClass } from "./siteTheme";

export default function SmsProgramView() {
  const [locale, setLocale] = useState<SmsProgramLocale>("en");
  const copy = SMS_PROGRAM_COPY[locale];

  return (
    <section className={`${siteContainerClass} py-12 text-white`}>
      <div className="mb-6 flex items-center justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-300">
          {copy.eyebrow}
        </p>
        <SmsProgramLocaleToggle locale={locale} onChange={setLocale} />
      </div>

      <h1 className="max-w-3xl text-4xl font-bold tracking-tight max-sm:text-3xl">
        {copy.headline}
      </h1>
      <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-300">{copy.intro}</p>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <div className="space-y-6 text-sm leading-relaxed text-slate-300">
          <section>
            <h2 className="text-lg font-semibold text-white">{copy.whoTitle}</h2>
            <p className="mt-2">{copy.whoBody}</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">{copy.whatTitle}</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {copy.whatItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">{copy.frequencyTitle}</h2>
            <p className="mt-2">{copy.frequencyBody}</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">{copy.consentTitle}</h2>
            <p className="mt-2">{copy.consentBody}</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">{copy.ratesTitle}</h2>
            <p className="mt-2">{copy.ratesBody}</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">{copy.stopTitle}</h2>
            <p className="mt-2">{copy.stopBody}</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">{copy.helpTitle}</h2>
            <p className="mt-2">{copy.helpBody}</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">{copy.legalTitle}</h2>
            <p className="mt-2">
              <a className="text-orange-300 underline" href={SMS_LEGAL_LINKS.privacy}>
                {copy.privacyLabel}
              </a>
              {" · "}
              <a className="text-orange-300 underline" href={SMS_LEGAL_LINKS.terms}>
                {copy.termsLabel}
              </a>
              {" · "}
              <a className="text-orange-300 underline" href={SMS_LEGAL_LINKS.support}>
                {copy.supportLabel}
              </a>
            </p>
          </section>
        </div>

        <div>
          <SmsOptInForm key={copy.locale} copy={copy} />
        </div>
      </div>
    </section>
  );
}
