import { NextRequest } from "next/server";

export const runtime = "nodejs";

function buildVoiceTwiml() {
  return `
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Welcome to MMD Delivery voice system.</Say>
</Response>
  `.trim();
}

export async function GET() {
  return new Response(buildVoiceTwiml(), {
    status: 200,
    headers: {
      "Content-Type": "text/xml",
    },
  });
}

export async function POST(req: NextRequest) {
  return new Response(buildVoiceTwiml(), {
    status: 200,
    headers: {
      "Content-Type": "text/xml",
    },
  });
}