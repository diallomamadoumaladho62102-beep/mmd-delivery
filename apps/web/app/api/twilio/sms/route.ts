export const runtime = "nodejs";

function buildSmsTwiml() {
  return `
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Welcome to MMD Delivery support. We received your message.</Message>
</Response>
  `.trim();
}

export async function GET() {
  return new Response(buildSmsTwiml(), {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST() {
  return new Response(buildSmsTwiml(), {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}