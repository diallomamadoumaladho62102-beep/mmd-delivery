/**
 * Fail-open boot helpers — never leave App Review stuck on Splash / Chargement.
 * Timeouts must resolve so RoleSelect / Login can render on iPad and iPhone.
 */

export const BOOT_AUTH_TIMEOUT_MS = 8_000;
export const BOOT_FONT_TIMEOUT_MS = 5_000;
export const BOOT_SHELL_TIMEOUT_MS = 12_000;
/** Network auth actions (sign-in / reset) — never leave a full-screen hang. */
export const AUTH_ACTION_TIMEOUT_MS = 20_000;

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
