import { NextRequest } from "next/server";
import { resolveLocationGetRequest } from "@/lib/mmdLocationGetRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const result = await resolveLocationGetRequest({
    req,
    locationId: id,
    forTrip: false,
  });
  if (result.ok === false) return result.response;
  return result.response;
}
