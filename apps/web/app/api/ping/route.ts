import { NextResponse } from "next/server";

export async function GET() {
  console.log("API /api/ping GET hit");
  return NextResponse.json({
    ok: true,
    method: "GET",
    time: new Date().toISOString(),
  });
}

export async function POST() {
  console.log("API /api/ping POST hit");
  return NextResponse.json({
    ok: true,
    method: "POST",
    time: new Date().toISOString(),
  });
}
