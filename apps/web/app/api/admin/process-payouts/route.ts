export async function POST() {
  try {
    const res = await fetch(
      "https://sjmszohmhudayxawfows.supabase.co/functions/v1/process_driver_payouts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          "x-cron-secret": process.env.CRON_SECRET!,
        },
      }
    );

    const data = await res.json();

    return Response.json({
      ok: true,
      data,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: String(e) },
      { status: 500 }
    );
  }
}