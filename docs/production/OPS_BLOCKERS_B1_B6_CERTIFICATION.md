# Certification Ops — Blockers B1 à B6 (GO build production)

**Objectif :** fermer manuellement les 6 blockers ops restants avant `eas build --profile production` Android/iOS.  
**Scope :** ops uniquement — aucune feature V2, aucun changement design ou logique métier.  
**Références code :** `docs/production/sql/final_certification_checks.sql`, `docs/production/final-certification.env.example`, `apps/web/scripts/final-production-certification.mjs`, `docs/production/FINAL_PRODUCTION_CERTIFICATION_RUNBOOK.md`.

**Artefacts à archiver (gitignored) :** `docs/production/reports/ops-b1-b6/` (créer localement ; ne jamais committer secrets).

---

## Préparation (une fois)

| Étape | Emplacement | Action |
|-------|-------------|--------|
| 1 | Machine locale | `copy docs\production\final-certification.env.example docs\production\final-certification.env` |
| 2 | `final-certification.env` | Renseigner `PROD_BASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CRON_SECRET` (si dispo) |
| 3 | Dossier preuves | Créer `docs/production/reports/ops-b1-b6/` avec sous-dossiers `B1/` … `B6/` |
| 4 | Script final | Après chaque blocker : noter PASS/FAIL dans `ops-b1-b6/sign-off-checklist.md` (copie locale) |

**Verdict global GO build** lorsque B1–B6 = PASS et :

```powershell
node apps/web/scripts/final-production-certification.mjs --env docs/production/final-certification.env
```

retourne exit code `0` et verdict `READY FOR REAL PUBLIC PRODUCTION`.

---

## B1 — Migrations trust-boundary Supabase

### Emplacement exact

| Système | Chemin UI |
|---------|-----------|
| **Supabase** | [Dashboard](https://supabase.com/dashboard) → projet **production** → **SQL Editor** |
| **Repo (référence)** | `supabase/migrations/20260716120000_food_order_trust_boundary.sql`, `20260717120000_production_hardening_p0_p1.sql`, `20260720120000_driver_locations_participant_read.sql` |
| **Script SQL** | `docs/production/sql/final_certification_checks.sql` |

### Étapes de vérification

1. Ouvrir **SQL Editor** sur le projet Supabase **production** (pas staging).
2. Coller et exécuter **section par section** `final_certification_checks.sql`.
3. Pour chaque section, comparer le résultat au commentaire `-- EXPECTED:` dans le fichier SQL.

| Section SQL | Vérification | Résultat attendu |
|-------------|--------------|------------------|
| §1 Migrations | `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version IN ('20260716120000','20260717120000','20260720120000')` | **3 lignes** : trust boundary, P0/P1 hardening, driver_locations participant read |
| §2 RLS | `orders`, `delivery_requests`, `taxi_rides` | **3 lignes**, `rls_enabled = true` |
| §3 INSERT policies | Forbidden policy names query | **0 lignes** |
| §4 Triggers | `trg_guard_orders_client_financial_update`, `trg_guard_delivery_requests_client_financial_update` | **2 lignes**, `tgenabled = 'O'` |
| §4b Functions | `guard_orders_client_financial_update`, `guard_delivery_requests_client_financial_update` | **2 lignes** |
| §5 Legacy UPDATE | `orders update roles` policies | **0 lignes** |
| §5 stripe_webhook_events | SELECT COUNT | Requête **réussit** (pas d’erreur permission) |
| §6 AI / platform | counts + `ai_enabled` column | Selon EXPECTED dans SQL |
| §7 platform_countries | COUNT | **11** lignes |

4. **(Optionnel renforcé)** Dans `final-certification.env` :

   ```
   CERTIFICATION_ALLOW_RLS_PROBE=true
   TEST_CLIENT_JWT=<access_token client test>
   ```

   Relancer le script Node → checks `rls_block_*_insert` doivent **PASS**.

5. Sign-off env :

   ```
   SUPABASE_TRUST_BOUNDARY_SQL_DONE=true
   SUPABASE_TRUST_BOUNDARY_SQL_VALIDATED_AT=2026-06-04
   ```

### Captures d’écran à fournir

| Fichier suggéré | Contenu |
|-----------------|---------|
| `B1/01-migrations-two-rows.png` | Résultat §1 — 2 migrations visibles |
| `B1/02-rls-enabled.png` | Résultat §2 — 3 tables RLS true |
| `B1/03-forbidden-insert-zero.png` | Résultat §3 — 0 forbidden policies |
| `B1/04-triggers-enabled.png` | Résultat §4 — 2 triggers O |
| `B1/05-sql-editor-full.png` | Vue SQL Editor avec onglet/query exécutée |

### Critères PASS / FAIL

| | Critère |
|---|---------|
| **PASS** | Toutes les sections §1–§4 + §5 webhook table + §7 count=11 conformes aux EXPECTED |
| **FAIL** | Migration absente, RLS false, policy INSERT client présente, trigger absent/disabled, count platform_countries ≠ 11 |

### Plan de rollback

| Situation | Action |
|-----------|--------|
| Migration appliquée par erreur sur mauvais projet | **Ne pas** rollback aveugle. Restaurer backup Supabase point-in-time si disponible ; sinon appliquer migration corrective avec support Supabase. |
| RLS trop restrictive (app cassée) | Identifier policy/trigger via logs ; rollback migration spécifique depuis backup ou migration hotfix **validée en staging d’abord**. |
| Vérification FAIL mais prod semble OK | **STOP GO** — ne pas signer ; ré-exécuter SQL sur le bon projet ; comparer `schema_migrations` avec staging. |

---

## B2 — Stripe Dashboard webhook unique (Live)

### Emplacement exact

| Système | Chemin UI |
|---------|-----------|
| **Stripe** | [Dashboard](https://dashboard.stripe.com) → **Developers** → **Webhooks** → basculer **Live mode** (toggle en haut) |
| **Vercel** | Project → **Settings** → **Environment Variables** → Production → `STRIPE_WEBHOOK_SECRET` |
| **Repo (handler)** | `apps/web/app/api/stripe/webhook/route.ts` |
| **Health (preuve runtime)** | `GET https://www.mmddelivery.com/api/health/stripe-webhook` |

### Étapes de vérification

1. Stripe Dashboard → **Developers → Webhooks** (mode **Live**).
2. Compter les endpoints actifs :
   - **PASS** si exactement **1** endpoint.
   - URL doit être **`https://www.mmddelivery.com/api/stripe/webhook`** (pas de trailing slash divergent).
3. Vérifier qu’**aucune** URL du type `{SUPABASE_PROJECT}.supabase.co/functions/v1/stripe_webhook` n’est listée.
4. Ouvrir l’endpoint → **Signing secret** → confirmer qu’il correspond à `STRIPE_WEBHOOK_SECRET` sur Vercel Production.
5. Vérifier événements minimum abonnés : `checkout.session.completed`, `payment_intent.succeeded` (et autres requis par le handler).
6. (Post test paiement contrôlé) Onglet **Recent deliveries** : 1 delivery par `event.id`, HTTP 200.
7. Appeler health (navigateur ou curl) :

   ```
   GET https://www.mmddelivery.com/api/health/stripe-webhook
   ```

   Attendu JSON : `canonical_webhook_url` = URL ci-dessus, `edge_webhook_must_be_disabled: true`.

8. SQL Supabase (section §5 du script certification) :

   ```sql
   SELECT stripe_event_id, event_type, received_at
   FROM public.stripe_webhook_events
   ORDER BY received_at DESC LIMIT 5;
   ```

   Chaque `stripe_event_id` unique.

9. Sign-off env :

   ```
   STRIPE_DASHBOARD_CHECK_DONE=true
   STRIPE_UNIQUE_WEBHOOK_CONFIRMED=true
   ```

### Captures d’écran à fournir

| Fichier suggéré | Contenu |
|-----------------|---------|
| `B2/01-stripe-webhooks-list-live.png` | Liste webhooks Live — **1 seul** endpoint |
| `B2/02-endpoint-url-detail.png` | Détail URL `www.mmddelivery.com/api/stripe/webhook` |
| `B2/03-signing-secret-redacted.png` | Secret masqué (montrer les 4 derniers chars seulement) + confirmation Vercel |
| `B2/04-recent-deliveries.png` | Deliveries récentes après test (si effectué) |
| `B2/05-health-stripe-webhook-json.png` | Réponse `/api/health/stripe-webhook` |

### Critères PASS / FAIL

| | Critère |
|---|---------|
| **PASS** | 1 endpoint Live, URL canonique, secret Vercel aligné, pas d’URL Edge Supabase, health OK |
| **FAIL** | 0 ou 2+ endpoints, URL incorrecte, secret mismatch, deliveries dupliquées pour même `event.id` |

### Plan de rollback

| Situation | Action |
|-----------|--------|
| Mauvais secret sur Vercel | Restaurer ancienne valeur env Vercel → redeploy → retester webhook test event |
| Endpoint dupliqué créé | Désactiver/supprimer endpoint non canonique dans Stripe Dashboard |
| Webhook pointe vers Edge | Désactiver endpoint Edge ; ne garder que Vercel ; renvoyer events failed si nécessaire depuis Stripe |

---

## B3 — Edge function `stripe_webhook` désactivée

### Emplacement exact

| Système | Chemin UI |
|---------|-----------|
| **Supabase** | Dashboard → **Edge Functions** → `stripe_webhook` → **Secrets** |
| **Repo** | `supabase/functions/stripe_webhook/index.ts` (L236–250) |
| **Probe HTTP** | `POST {SUPABASE_URL}/functions/v1/stripe_webhook` |

### Étapes de vérification

1. Supabase Dashboard → Edge Functions → **`stripe_webhook`**.
2. Secrets → ajouter ou confirmer :

   ```
   MMD_STRIPE_WEBHOOK_DISABLED=true
   ```

3. **Ne pas** définir `MMD_STRIPE_WEBHOOK_EDGE_ENABLED=true` en production.
4. Probe (PowerShell) :

   ```powershell
   Invoke-WebRequest -Method POST -Uri "https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe_webhook" -Headers @{ "Authorization" = "Bearer YOUR_ANON_KEY" }
   ```

   **Résultat attendu (PASS)** — l’un des deux :
   - HTTP **200** + body JSON contenant `"disabled": true`, ou
   - HTTP **410** + `"error": "edge_webhook_disabled"`

5. Confirmer que Stripe Dashboard (B2) n’envoie **pas** vers cette URL.
6. Sign-off env :

   ```
   EDGE_WEBHOOK_DISABLED_CONFIRMED=true
   ```

### Captures d’écran à fournir

| Fichier suggéré | Contenu |
|-----------------|---------|
| `B3/01-edge-secrets-disabled.png` | Secret `MMD_STRIPE_WEBHOOK_DISABLED=true` visible |
| `B3/02-probe-response.png` | Réponse POST (status + body disabled/410) |
| `B3/03-stripe-no-edge-url.png` | (Reprise B2) aucune URL Edge dans Stripe webhooks |

### Critères PASS / FAIL

| | Critère |
|---|---------|
| **PASS** | Secret `MMD_STRIPE_WEBHOOK_DISABLED=true` + probe disabled/410 + Stripe sans URL Edge |
| **FAIL** | Probe traite un event Stripe (200 sans `disabled`), ou secret absent |

### Plan de rollback

| Situation | Action |
|-----------|--------|
| Edge réactivée par erreur | Remettre `MMD_STRIPE_WEBHOOK_DISABLED=true` → redeploy function → re-probe |
| Besoin temporaire Edge (urgence) | **Interdit en prod parallèle** — désactiver Vercel webhook d’abord ; documenter fenêtre ; revenir au handler unique Vercel ASAP |

---

## B4 — Edge payouts désactivés

### Emplacement exact

| Système | Chemin UI |
|---------|-----------|
| **Supabase** | Dashboard → **Edge Functions** → Secrets **par fonction** |
| **Repo** | `supabase/functions/process_driver_payouts/`, `weekly_restaurant_payout/`, `pay_restaurant_scheduled/`, `pay_restaurant_now/`, `pay-driver-now/` |
| **Handler canonique** | Vercel `POST /api/admin/process-payouts`, `POST /api/stripe/transfers/run` |
| **Doc** | `docs/production/PAYOUTS_SINGLE_HANDLER.md` |

### Fonctions concernées (secret identique sur chacune)

| Edge function | Fichier guard |
|---------------|---------------|
| `process_driver_payouts` | `MMD_EDGE_PAYOUTS_DISABLED` |
| `weekly_restaurant_payout` | idem |
| `pay_restaurant_scheduled` | idem |
| `pay_restaurant_now` | idem |
| `pay-driver-now` | idem |

### Étapes de vérification

1. Pour **chaque** fonction ci-dessus : Edge Functions → fonction → Secrets →

   ```
   MMD_EDGE_PAYOUTS_DISABLED=true
   ```

2. Vercel Production → confirmer `MMD_PAYOUT_MODE` (recommandé : `hybrid` — voir `PAYOUTS_SINGLE_HANDLER.md`).
3. Vercel → Cron Jobs → confirmer `process-payouts` planifié (dim 03:00 UTC dans `vercel.json`).
4. Probe optionnelle (sans argent réel) : invoquer function Edge avec JWT service — attendre **200** + `"disabled": true` sans transfer Stripe.
5. SQL surveillance (pas de double payout récent) :

   ```sql
   SELECT id, order_id, target, status, stripe_transfer_id, created_at
   FROM public.order_payouts
   ORDER BY created_at DESC LIMIT 10;
   ```

6. **Ne pas** activer `CERTIFICATION_ALLOW_PAYOUT_CRON=true` sauf revue founder explicite (argent réel).

### Captures d’écran à fournir

| Fichier suggéré | Contenu |
|-----------------|---------|
| `B4/01-edge-payout-secrets-all-functions.png` | Liste des 5 fonctions avec secret disabled |
| `B4/02-vercel-payout-mode.png` | `MMD_PAYOUT_MODE=hybrid` (ou mode choisi documenté) |
| `B4/03-vercel-cron-process-payouts.png` | Dernier run cron process-payouts |
| `B4/04-order-payouts-sql.png` | Résultat SQL order_payouts (sans anomalies duplicate) |

### Critères PASS / FAIL

| | Critère |
|---|---------|
| **PASS** | Secret disabled sur les 5 fonctions ; payouts canoniques Vercel documentés ; pas de transfer Edge actif |
| **FAIL** | Secret absent sur une fonction ; Edge exécute un payout ; double `stripe_transfer_id` pour même order |

### Plan de rollback

| Situation | Action |
|-----------|--------|
| Payout Edge exécuté par erreur | Stop cron Edge ; audit Stripe transfers ; compenser manuellement ; remettre disabled=true |
| Vercel cron payout en échec | Logs Vercel → fix env `STRIPE_SECRET_KEY` / commissions ; **ne pas** réactiver Edge batch |

---

## B5 — Cron externe dispatch

### Emplacement exact

| Système | Chemin UI |
|---------|-----------|
| **Vercel** | Project → **Settings** → Environment Variables → `CRON_SECRET`, `DISPATCH_INTERNAL_SECRET` |
| **Vercel** | **Cron Jobs** (3 jobs natifs seulement — pas dispatch retry) |
| **Provider externe** | cron-job.org, GitHub Actions, ou Vercel Pro — **obligatoire sur Hobby** |
| **Repo routes** | `apps/web/app/api/cron/retry-order-dispatch/route.ts`, `retry-taxi-dispatch`, `taxi-scheduled-dispatch` |
| **Doc** | `docs/production/DISPATCH_CRON_STRATEGY.md` |

### Crons Vercel natifs (déjà planifiés — ne pas confondre avec B5)

| Schedule UTC | Path |
|--------------|------|
| Sun 03:00 | `/api/admin/process-payouts` |
| Daily 05:00 | `/api/orders/expire-unpaid` |
| Daily 06:00 | `/api/cron/taxi-monitoring-snapshot` |

### Crons externes requis (B5)

| Intervalle | URL complète | Header |
|------------|--------------|--------|
| 2–5 min | `https://www.mmddelivery.com/api/cron/retry-order-dispatch` | `Authorization: Bearer $CRON_SECRET` |
| 2–5 min | `https://www.mmddelivery.com/api/cron/retry-taxi-dispatch` | idem |
| 1–5 min | `https://www.mmddelivery.com/api/cron/taxi-scheduled-dispatch` | idem |

### Étapes de vérification

1. Vercel Production → copier valeur `CRON_SECRET` (ne pas committer).
2. Test **sans** secret (doit échouer) :

   ```powershell
   Invoke-WebRequest -Uri "https://www.mmddelivery.com/api/cron/retry-order-dispatch" -UseBasicParsing
   ```

   **Attendu : HTTP 401**

3. Test **avec** secret :

   ```powershell
   $h = @{ Authorization = "Bearer YOUR_CRON_SECRET" }
   Invoke-WebRequest -Uri "https://www.mmddelivery.com/api/cron/retry-order-dispatch" -Headers $h -UseBasicParsing
   ```

   **Attendu : HTTP 200** + JSON (ex. `processed`, `ok`).

4. Répéter pour `retry-taxi-dispatch` et `taxi-scheduled-dispatch`.
5. Configurer provider externe (cron-job.org exemple) :
   - URL : les 3 paths ci-dessus
   - Method : GET ou POST (routes acceptent les deux)
   - Header : `Authorization: Bearer <CRON_SECRET>`
   - Intervalle : 2–5 minutes
6. Attendre 10–15 min → vérifier **history/log** du provider (200 OK).
7. Script Node avec `CRON_SECRET` dans `final-certification.env` → checks `cron_*` **PASS**.

### Captures d’écran à fournir

| Fichier suggéré | Contenu |
|-----------------|---------|
| `B5/01-vercel-cron-secret-redacted.png` | CRON_SECRET défini (valeur masquée) |
| `B5/02-401-without-secret.png` | Réponse 401 sans header |
| `B5/03-200-with-secret.png` | Réponse 200 avec Bearer secret (JSON body) |
| `B5/04-external-cron-config.png` | cron-job.org / GH Actions — 3 jobs configurés |
| `B5/05-external-cron-history.png` | Historique exécutions 200 sur 15 min |

### Critères PASS / FAIL

| | Critère |
|---|---------|
| **PASS** | 401 sans secret ; 200 avec secret sur les 3 routes ; provider externe actif ; logs réguliers |
| **FAIL** | 200 sans secret ; 401 avec secret ; aucun provider externe ; pas d’exécution depuis >15 min |

### Plan de rollback

| Situation | Action |
|-----------|--------|
| CRON_SECRET leak | Régénérer secret Vercel → mettre à jour provider externe → invalider ancien |
| Cron trop agressif | Augmenter intervalle à 5 min ; monitor charge Vercel |
| **Ne pas** ajouter sub-hour crons dans `vercel.json` Hobby | Deploy échouera — garder externe uniquement |

---

## B6 — EAS secrets production (Expo)

### Emplacement exact

| Système | Chemin UI |
|---------|-----------|
| **Expo / EAS** | [expo.dev](https://expo.dev) → projet **mmd-delivery** → **Secrets** → environment **production** |
| **CLI** | `eas secret:list --environment production` (depuis repo root) |
| **Repo** | `eas.json` (profile production), `app.config.ts` (guards build) |
| **Project ID** | `127751ea-33ce-4f67-98ce-a9b29a46b838` |

### Secrets requis (production)

| Variable | Format attendu | Si absent |
|----------|----------------|-----------|
| `EXPO_PUBLIC_STRIPE_PK` | `pk_live_*` | Build **throw** (`app.config.ts` L24–28) |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://*.supabase.co` | Auth cassée |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | JWT anon prod | Auth cassée |
| `EXPO_PUBLIC_MAPBOX_TOKEN` | Token Mapbox public | Maps dégradées |
| `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` | Token download Mapbox | Build native Mapbox peut échouer |

`eas.json` production ne contient **que** :

```json
"APP_ENV": "production",
"EXPO_PUBLIC_API_URL_PROD": "https://www.mmddelivery.com"
```

→ Tous les secrets ci-dessus doivent être dans **EAS Secrets**, pas dans le repo.

### Étapes de vérification

1. Terminal (repo root, EAS CLI connecté) :

   ```powershell
   eas secret:list --environment production
   ```

2. Confirmer présence des **5** variables listées.
3. Confirmer `EXPO_PUBLIC_STRIPE_PK` commence par `pk_live_` (**pas** `pk_test_`).
4. Build de validation (internal/preview si besoin d’abord) :

   ```powershell
   eas build --profile production --platform android --non-interactive
   ```

   **Attendu :** build démarre sans erreur `[MMD] Production EAS build requires EXPO_PUBLIC_STRIPE_PK`.

5. Après build : installer APK/AAB test → login Supabase → ouvrir écran avec carte (driver map ou location picker) → Mapbox rendu OK.
6. Play submit : confirmer `google-play-service-account.json` existe **localement** (hors repo) si submit Android prévu.

### Captures d’écran à fournir

| Fichier suggéré | Contenu |
|-----------------|---------|
| `B6/01-eas-secrets-list-redacted.png` | Liste secrets production (noms visibles, valeurs masquées) |
| `B6/02-eas-build-started.png` | EAS dashboard — build production lancé |
| `B6/03-eas-build-success.png` | Build terminé success |
| `B6/04-app-login-map-smoke.png` | Device : login + carte Mapbox fonctionnelle |

### Critères PASS / FAIL

| | Critère |
|---|---------|
| **PASS** | 5 secrets présents ; pk_live_ ; build production success ; smoke login + map OK |
| **FAIL** | Secret manquant ; pk_test_ en prod ; build fail Mapbox/Stripe ; auth Supabase KO sur device |

### Plan de rollback

| Situation | Action |
|-----------|--------|
| Mauvaise clé Stripe publiée | Mettre à jour EAS secret → **nouveau build** (OTA ne remplace pas native Stripe config init) |
| Mauvais Supabase URL | Corriger secret → rebuild |
| Build Mapbox fail | Vérifier `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` Mapbox account → retry build |

---

## Checklist finale exécutable (sign-off founder)

Cocher localement (`docs/production/reports/ops-b1-b6/sign-off-checklist.md`) :

```
[ ] B1 — SQL final_certification_checks.sql — toutes sections EXPECTED OK
[ ] B1 — SUPABASE_TRUST_BOUNDARY_SQL_DONE=true dans final-certification.env
[ ] B2 — Stripe Live : 1 webhook → www.mmddelivery.com/api/stripe/webhook
[ ] B2 — STRIPE_WEBHOOK_SECRET Vercel = signing secret Stripe
[ ] B2 — STRIPE_DASHBOARD_CHECK_DONE=true + STRIPE_UNIQUE_WEBHOOK_CONFIRMED=true
[ ] B3 — MMD_STRIPE_WEBHOOK_DISABLED=true sur Edge stripe_webhook
[ ] B3 — Probe Edge → disabled:true ou HTTP 410
[ ] B3 — EDGE_WEBHOOK_DISABLED_CONFIRMED=true
[ ] B4 — MMD_EDGE_PAYOUTS_DISABLED=true sur 5 fonctions payout Edge
[ ] B4 — MMD_PAYOUT_MODE documenté sur Vercel
[ ] B5 — CRON_SECRET sur Vercel
[ ] B5 — 401 sans secret / 200 avec secret (3 routes dispatch)
[ ] B5 — Provider externe configuré + historique 200 OK
[ ] B6 — eas secret:list — 5 secrets production OK
[ ] B6 — eas build production — SUCCESS
[ ] B6 — Device smoke : auth + Mapbox OK
[ ] FINAL — node final-production-certification.mjs → exit 0, READY
[ ] GO — Autorisation build stores Android + iOS production
```

---

## Ordre d’exécution recommandé

1. **B1** (fondation DB)  
2. **B2 + B3** (Stripe single handler — liés)  
3. **B4** (payouts Edge off)  
4. **B5** (dispatch crons)  
5. **B6** (EAS build)  
6. **Script final** + archive dossier `ops-b1-b6/`

---

## Liens croisés

| Document | Usage |
|----------|-------|
| `FINAL_PRODUCTION_CERTIFICATION_RUNBOOK.md` | Runbook complet + troubleshooting |
| `DISPATCH_CRON_STRATEGY.md` | Détail crons Hobby vs Pro |
| `STRIPE_WEBHOOK_SINGLE_HANDLER.md` | Stripe canonical URL |
| `PAYOUTS_SINGLE_HANDLER.md` | Modes payout Vercel vs Edge |
| `EXTERNAL_OPS_MANUAL.md` | Ops manuels complémentaires |
| `final-certification.env.example` | Template flags sign-off |

**Fin du dossier B1–B6 — aucun développement produit requis pour GO ops.**
