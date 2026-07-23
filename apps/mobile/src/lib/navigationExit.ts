/**
 * Pure helpers for Mapbox exit designations — no React Native imports.
 */

/** Pull a real highway exit designation from Mapbox fields / instruction text. */
export function extractMapboxExitNumber(params: {
  exits?: string | string[] | null;
  ref?: string | null;
  instruction?: string | null;
  maneuverType?: string | null;
}): string | null {
  const fromExits = Array.isArray(params.exits)
    ? params.exits.map((v) => String(v).trim()).find(Boolean)
    : String(params.exits ?? "").trim();
  if (fromExits) return fromExits;

  const instruction = String(params.instruction ?? "");
  const fromText = instruction.match(
    /\b(?:exit|sortie|salida)\s+([0-9]+[A-Za-z]?)\b/i,
  );
  if (fromText?.[1]) return fromText[1].toUpperCase();

  const type = String(params.maneuverType ?? "").toLowerCase();
  const ref = String(params.ref ?? "").trim();
  // Only treat `ref` as an exit when this step is clearly an off-ramp / exit.
  if (
    ref &&
    (type.includes("exit") || type === "off ramp" || type === "on ramp") &&
    /^[0-9]+[A-Za-z]?$/.test(ref)
  ) {
    return ref.toUpperCase();
  }

  return null;
}
