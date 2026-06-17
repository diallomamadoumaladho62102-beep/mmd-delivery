# Commercial launch readiness

Items **not blocking** store submission or EAS build.  
Blocking **public commercial launch** in US at scale.

| Item | Type | Code status | Ops / legal | Automated | Final |
|------|------|-------------|-------------|-----------|-------|
| External dispatch crons (retry-order/taxi/scheduled) | **ops** | Routes exist, CRON_SECRET protected | Configure cron-job.org or Vercel Pro | WARN until `EXTERNAL_DISPATCH_CRON_CONFIGURED=true` | **WARNING** |
| SMS A2P 10DLC US | **legal** | Twilio SMS code ready | LLC/EIN + Twilio registration | WARN until `SMS_A2P_10DLC_US_DONE=true` | **WARNING** |
| Live payment E2E sign-off | **ops** | Stripe webhook + checkout code PASS | Founder smoke food/delivery/taxi Live | MANUAL | **MANUAL** |
| Marketplace live flags | **business** | Defaults `false` in `.env.example` | Intentional shadow/off | **PASS** | **PASS** |
| B6 device smoke | **device** | Push/deep link code PASS | Physical device checklist | MANUAL | **MANUAL** |
| Twilio masked call E2E | **ops** | API + permissions PASS | Real call on active trip | MANUAL | **MANUAL** |
| Play service account | **store** | eas.json path PASS | Local JSON file | MANUAL | **MANUAL** |

## Verdict matrix

| Milestone | When automated script PASS | When all sign-offs true |
|-----------|---------------------------|-------------------------|
| **EAS production build** | GO | GO |
| **Store submission upload** | GO (technical) | GO (full) |
| **Commercial launch US** | GO conditionnel | GO conditionnel* |

\*Commercial **GO** still requires external crons + SMS A2P for US SMS at scale. Payments can launch with Live Stripe once `LIVE_PAYMENT_E2E_SIGNOFF_DONE=true`.

## References

- `docs/production/DISPATCH_CRON_STRATEGY.md`
- `docs/production/EXTERNAL_OPS_MANUAL.md`
- `docs/production/B6_STORE_SUBMISSION_DEVICE_SMOKE.md`
