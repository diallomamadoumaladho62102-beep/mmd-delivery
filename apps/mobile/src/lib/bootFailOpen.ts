/**
 * Fail-open boot helpers — never leave App Review stuck on Splash / Chargement.
 * Timeouts must resolve so RoleSelect / Login can render on iPad and iPhone.
 */

export const BOOT_AUTH_TIMEOUT_MS = 8_000;
export const BOOT_FONT_TIMEOUT_MS = 5_000;
export const BOOT_SHELL_TIMEOUT_MS = 12_000;
/** Network auth actions (sign-in / reset) — never leave a full-screen hang. */
export const AUTH_ACTION_TIMEOUT_MS = 20_000;
/**
 * Client Home first paint. Apple Review 2.1(a) showed this screen spinning
 * indefinitely after login. Fail-open so a hung getSession / PostgREST / ads
 * fetch cannot leave the branded loader forever. Same budget as boot auth.
 */
export const CLIENT_HOME_FETCH_TIMEOUT_MS = 8_000;

/** Client secondary screens (wallet, history, receipt, AI) — same fail-open budget as #121. */
export const CLIENT_SCREEN_FETCH_TIMEOUT_MS = 8_000;

/** Driver map trip load / Mapbox Directions — never leave nav loader forever. */
export const DRIVER_NAV_FETCH_TIMEOUT_MS = 8_000;

/**
 * Abortable fetch with a wall-clock timeout so hung TCP never leaves a spinner forever.
 * Prefer this over bare `fetch` on Apple Review–reachable mobile screens.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  ms: number,
  label: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const upstream = init?.signal;
  const onUpstreamAbort = () => controller.abort();
  if (upstream) {
    if (upstream.aborted) controller.abort();
    else upstream.addEventListener("abort", onUpstreamAbort, { once: true });
  }
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    const aborted =
      (error instanceof Error && error.name === "AbortError") ||
      controller.signal.aborted;
    if (aborted && !upstream?.aborted) {
      throw new Error(`${label}_timeout_${ms}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    upstream?.removeEventListener("abort", onUpstreamAbort);
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}_timeout_${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** True when fonts are loaded, failed, or timed out — UI must proceed either way. */
export function areFontsReady(params: {
  fontsLoaded: boolean;
  fontError: Error | null | undefined;
  fontTimedOut: boolean;
}): boolean {
  return (
    params.fontsLoaded === true ||
    Boolean(params.fontError) ||
    params.fontTimedOut === true
  );
}
