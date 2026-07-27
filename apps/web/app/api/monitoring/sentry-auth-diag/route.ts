import { NextRequest, NextResponse } from "next/server";
import { isInternalHealthAuthorized } from "@/lib/internalHealthAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PrefixClass =
  | "sntrys_org"
  | "sntryu_user"
  | "jwt"
  | "empty"
  | "other";

function classifyPrefix(token: string): PrefixClass {
  if (!token) return "empty";
  if (token.startsWith("sntrys_")) return "sntrys_org";
  if (token.startsWith("sntryu_")) return "sntryu_user";
  if (token.split(".").length === 3) return "jwt";
  return "other";
}

function jwtExpIso(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
        "utf8"
      )
    ) as { exp?: number };
    if (!payload.exp || !Number.isFinite(payload.exp)) return null;
    return new Date(payload.exp * 1000).toISOString();
  } catch {
    return null;
  }
}

/**
 * POST /api/monitoring/sentry-auth-diag
 * Auth: MONITORING_SECRET or CRON_SECRET.
 * Diagnoses SENTRY_AUTH_TOKEN usability without exposing the token value.
 */
export async function POST(request: NextRequest) {
  if (!isInternalHealthAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const token = String(process.env.SENTRY_AUTH_TOKEN ?? "").trim();
  const org = String(process.env.SENTRY_ORG ?? "mmd-delivery").trim();
  const project = String(process.env.SENTRY_PROJECT ?? "mmd-delivery-web").trim();
  const expIso = jwtExpIso(token);
  const expired =
    expIso != null ? Date.parse(expIso) < Date.now() : null;

  const meta = {
    present: token.length > 0,
    length: token.length,
    prefixClass: classifyPrefix(token),
    hasWhitespace: /\s/.test(String(process.env.SENTRY_AUTH_TOKEN ?? "")),
    org,
    project,
    jwtExpIso: expIso,
    jwtExpired: expired,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  };

  if (!token) {
    return NextResponse.json({
      ok: false,
      primaryCause: "not_injected_at_runtime",
      meta,
      api: null,
      message:
        "SENTRY_AUTH_TOKEN is empty in this runtime. Present in Vercel dashboard but not available to the process.",
    });
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  async function safeGet(url: string) {
    try {
      const res = await fetch(url, { headers, cache: "no-store" });
      const text = await res.text();
      let detail: string | null = null;
      try {
        const j = JSON.parse(text) as { detail?: string };
        detail = j.detail ? String(j.detail).slice(0, 240) : null;
      } catch {
        detail = text.slice(0, 120) || null;
      }
      return { status: res.status, detail };
    } catch (e) {
      return {
        status: 0,
        detail: e instanceof Error ? e.message.slice(0, 120) : "fetch_failed",
      };
    }
  }

  const orgs = await safeGet("https://sentry.io/api/0/organizations/");
  const orgDetail = await safeGet(
    `https://sentry.io/api/0/organizations/${encodeURIComponent(org)}/`
  );
  const projects = await safeGet(
    `https://sentry.io/api/0/organizations/${encodeURIComponent(org)}/projects/`
  );
  const releasesRes = await fetch(
    `https://sentry.io/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/releases/?per_page=8`,
    { headers, cache: "no-store" }
  );
  let releaseVersions: string[] = [];
  let releasesStatus = releasesRes.status;
  let releasesDetail: string | null = null;
  if (releasesRes.ok) {
    const rows = (await releasesRes.json().catch(() => [])) as Array<{
      version?: string;
    }>;
    releaseVersions = rows
      .map((r) => String(r.version ?? ""))
      .filter(Boolean)
      .slice(0, 8);
  } else {
    const text = await releasesRes.text();
    try {
      releasesDetail = String(
        (JSON.parse(text) as { detail?: string }).detail ?? ""
      ).slice(0, 240);
    } catch {
      releasesDetail = text.slice(0, 120) || null;
    }
  }

  const issuesRes = await fetch(
    `https://sentry.io/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/issues/?query=is:unresolved&limit=1`,
    { headers, cache: "no-store" }
  );
  const unresolvedApprox = issuesRes.headers.get("x-hits")
    ? Number(issuesRes.headers.get("x-hits"))
    : null;
  let unresolvedSample: string[] = [];
  if (issuesRes.ok) {
    const issues = (await issuesRes.json().catch(() => [])) as Array<{
      title?: string;
      shortId?: string;
    }>;
    unresolvedSample = issues
      .slice(0, 5)
      .map((i) => `${i.shortId ?? "?"}: ${String(i.title ?? "").slice(0, 80)}`);
  }

  const commitSha = String(
    process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? ""
  ).trim();
  const releaseMatch = releaseVersions.some(
    (v) =>
      (commitSha && v.includes(commitSha.slice(0, 7))) ||
      (commitSha && v.includes(commitSha))
  );

  let primaryCause = "unknown";
  if (expired === true) primaryCause = "expired";
  else if (orgs.status === 401 || orgs.status === 403) {
    const d = `${orgs.detail ?? ""}`.toLowerCase();
    if (d.includes("scope") || d.includes("permission")) {
      primaryCause = "insufficient_scopes";
    } else if (d.includes("not provided")) {
      primaryCause = "malformed";
    } else {
      primaryCause =
        meta.prefixClass === "sntrys_org" || meta.prefixClass === "sntryu_user"
          ? "wrong_account_or_revoked"
          : "wrong_token_type_or_revoked";
    }
  } else if (orgDetail.status === 404) {
    primaryCause = "wrong_org";
  } else if (orgs.status >= 200 && orgs.status < 300) {
    primaryCause = "valid_ok";
  }

  return NextResponse.json({
    ok: primaryCause === "valid_ok",
    primaryCause,
    meta: {
      ...meta,
      commitSha: commitSha || null,
      tokenNote:
        meta.prefixClass === "sntryu_user"
          ? "User auth token (sntryu_). Prefer Organization Auth Token (sntrys_) for CI/source maps long-term."
          : meta.prefixClass === "sntrys_org"
            ? "Organization Auth Token (recommended)."
            : null,
    },
    api: {
      organizations: orgs,
      organization: orgDetail,
      projects,
      releases: {
        status: releasesStatus,
        detail: releasesDetail,
        versions: releaseVersions,
        currentCommitMatched: releaseMatch,
      },
      unresolvedIssues: {
        status: issuesRes.status,
        xHits: Number.isFinite(unresolvedApprox as number)
          ? unresolvedApprox
          : null,
        sample: unresolvedSample,
      },
    },
    guidance: {
      replaceIn: [
        "Vercel → Project → Settings → Environment Variables → SENTRY_AUTH_TOKEN (Production + Preview)",
        "Optional local: apps/web/.env.local",
        "EAS only if uploading mobile symbols (not required for DSN ingest)",
        "GitHub Actions: not wired today — only add if CI uploads source maps",
      ],
      requiredToken:
        "Sentry Organization Auth Token (sntrys_…) with project:releases, project:releases:org, org:read (and sourcemaps upload scopes)",
      expectedOrg: org,
      expectedWebProject: project,
    },
  });
}
