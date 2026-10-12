"use client";

import { useEffect } from "react";

/** The complete client account form lives at /signup/client. */
export default function SignUpRedirect() {
  useEffect(() => {
    const search = window.location.search;
    window.location.replace(`/signup/client${search}`);
  }, []);

  return (
    <main className="mx-auto max-w-md p-6 text-sm text-slate-600">
      <p>Opening account creation…</p>
      <a className="text-blue-700 underline" href="/signup/client">
        Create account
      </a>
    </main>
  );
}
