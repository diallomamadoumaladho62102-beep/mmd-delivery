import { NextResponse } from "next/server";

export const runtime = "edge";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#0B1220"/></svg>`;

export async function GET() {
  return new NextResponse(SVG, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
