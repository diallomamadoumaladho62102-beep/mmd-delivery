import type { NextRequest } from "next/server";
import { mmdLocationJson, parseUuid, requireMmdLocationApiUser } from "@/lib/mmdLocationCore";
import {
  buildLocationTripView,
  driverCanReadLocationPoint,
  loadLocationPointById,
  loadOwnedLocationPoint,
} from "@/lib/mmdLocationSnapshot";
import { getProfileRole, isStaffRole } from "@/lib/taxiApi";

export async function resolveLocationGetRequest(params: {
  req: NextRequest;
  locationId: string;
  forTrip: boolean;
}) {
  const auth = await requireMmdLocationApiUser(params.req);
  if (auth.ok === false) return { ok: false as const, response: auth.response };

  let parsedId: string;
  try {
    parsedId = parseUuid(params.locationId, "location id");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid location id";
    return {
      ok: false as const,
      response: mmdLocationJson({ error: message }, 400),
    };
  }

  const role = await getProfileRole(auth.supabaseAdmin, auth.user.id);

  if (params.forTrip) {
    const owned = await loadOwnedLocationPoint(
      auth.supabaseAdmin,
      parsedId,
      auth.user.id
    );
    if (owned.ok) {
      const location = await buildLocationTripView(auth.supabaseAdmin, owned.row);
      return {
        ok: true as const,
        response: mmdLocationJson({ ok: true, location }),
      };
    }

    if (isStaffRole(role)) {
      const row = await loadLocationPointById(auth.supabaseAdmin, parsedId);
      if (!row) {
        return {
          ok: false as const,
          response: mmdLocationJson({ error: "Location not found" }, 404),
        };
      }
      const location = await buildLocationTripView(auth.supabaseAdmin, row);
      return {
        ok: true as const,
        response: mmdLocationJson({ ok: true, location }),
      };
    }

    const canRead = await driverCanReadLocationPoint(
      auth.supabaseAdmin,
      parsedId,
      auth.user.id
    );
    if (!canRead) {
      return {
        ok: false as const,
        response: mmdLocationJson({ error: "Forbidden" }, 403),
      };
    }

    const row = await loadLocationPointById(auth.supabaseAdmin, parsedId);
    if (!row) {
      return {
        ok: false as const,
        response: mmdLocationJson({ error: "Location not found" }, 404),
      };
    }

    const location = await buildLocationTripView(auth.supabaseAdmin, row);
    return {
      ok: true as const,
      response: mmdLocationJson({ ok: true, location }),
    };
  }

  const owned = await loadOwnedLocationPoint(
    auth.supabaseAdmin,
    parsedId,
    auth.user.id
  );
  if (owned.ok) {
    const location = await buildLocationTripView(auth.supabaseAdmin, owned.row);
    return {
      ok: true as const,
      response: mmdLocationJson({ ok: true, location }),
    };
  }

  if (isStaffRole(role)) {
    const row = await loadLocationPointById(auth.supabaseAdmin, parsedId);
    if (!row) {
      return {
        ok: false as const,
        response: mmdLocationJson({ error: "Location not found" }, 404),
      };
    }
    const location = await buildLocationTripView(auth.supabaseAdmin, row);
    return {
      ok: true as const,
      response: mmdLocationJson({ ok: true, location }),
    };
  }

  if (owned.ok === false) {
    return {
      ok: false as const,
      response: mmdLocationJson({ error: owned.error }, owned.status),
    };
  }

  return {
    ok: false as const,
    response: mmdLocationJson({ error: "Forbidden" }, 403),
  };
}
