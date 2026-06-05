# Registre officiel de production — MMD Delivery

**Version du registre :** 2026-06-04  
**Périmètre :** audit mission nuit + durcissement commercial (juin 2026)  
**Usage :** référence unique avant toute mise à jour (web, mobile, Supabase, Vercel, Stripe, stores).

**Légende statuts**

| Statut | Signification |
|--------|----------------|
| **Corrigé** | Correctif présent dans le dépôt Git (branche de travail auditée). |
| **Vérifié** | Revu dans le code et/ou `tsc` / `next build` passent localement. |
| **Déployé** | Appliqué en Supabase prod + Vercel prod + secrets Live (à confirmer par l’ops). |
| **Testé** | Smoke / E2E / parcours Live exécuté et signé (la plupart : **non** à ce jour). |

**Légende risque avant correction**

Critical · High · Medium · Low

**Légende régression**

| Valeur | Signification |
|--------|----------------|
| **Élevée** | Toute refonte du flux concerné peut réintroduire le bug. |
| **Moyenne** | Régression possible si conventions non respectées. |
| **Faible** | Garde-fous structurants (DB, types, RPC). |

---

## 1. Paiements Stripe

| Domaine | Problème initial | Risque réel | Correction appliquée | Fichiers modifiés | Migration associée | Risque avant | Statut actuel | Score (/100) | Régression ? | Surveillance |
|---------|------------------|-------------|----------------------|-------------------|-------------------|--------------|---------------|--------------|--------------|--------------|
| PaymentSheet mobile | Après succès PaymentSheet, échec `confirmOrderPaid` → ouverture Checkout | Double débit client | Flag `paymentSheetSucceeded` + `return` obligatoire ; message webhook ; pas de Checkout après succès sheet | `apps/mobile/src/screens/ClientOrderDetailsScreen.tsx` | — | Critical | Corrigé · Vérifié | 98 | Élevée | Tout changement `handlePay` : interdire fallback Checkout si sheet OK |
| Checkout session | Création session alors que PI Stripe déjà `succeeded` / en cours | Double session / double paiement | `paymentIntents.retrieve` ; `payment_already_succeeded` ; `payment_intent_in_progress` ; sync `mark_order_paid` si succeeded | `apps/web/app/api/stripe/client/create-checkout-session/route.ts` | — | Critical | Corrigé · Vérifié | 98 | Moyenne | Tests API : PI succeeded → 409 sans nouvelle session |
| Checkout proxy web | PayButton via `/api/stripe/client/checkout` | — | Proxy inchangé ; délègue à `create-checkout-session` (garde PI) | `apps/web/app/api/stripe/client/checkout/route.ts` | — | — | Vérifié | 95 | Faible | Conserver délégation unique |
| Webhooks (canonique) | Handler unique Vercel ; Edge dupliqué | Double traitement événements | Doc + secret `MMD_STRIPE_WEBHOOK_DISABLED` sur Edge | `apps/web/app/api/stripe/webhook/route.ts`, `docs/production/STRIPE_WEBHOOK_SINGLE_HANDLER.md` | — | Critical | Corrigé · Vérifié · Déployé* | 95 | Moyenne | Dashboard Stripe : une seule URL webhook Vercel |
| Webhooks — mark paid | Échec mark paid partiel | Commande impayée côté app | `markOrderPaidRobustly` + fallback (existant, renforcé par flux) | `apps/web/app/api/stripe/webhook/route.ts` | `20260602140000_*`, `20260603130000_*` | High | Vérifié | 92 | Moyenne | Logs webhook `Could not mark order paid` |
| Webhooks — duplicate recovery | Événement duplicate ignoré si déjà paid sans commissions | Payout sans montants | `stripeEventNeedsReprocessing` + `orderMissingCommissions` | `apps/web/src/lib/stripeWebhookReprocess.ts` | — | High | Corrigé · Vérifié | 95 | Moyenne | Replay webhook test : paid + sans ligne `order_commissions` |
| Double paiement (anti) | Chemins parallèles sheet + checkout | Fraude / chargeback | C1 + C2 + garde `isPaidStatus` | Voir C1/C2 | — | Critical | Corrigé · Vérifié | 97 | Élevée | QA mobile + web après chaque refonte paiement |
| Idempotence webhook | Insert audit + crash avant paid | État incohérent | Reprocess si unpaid ou commissions manquantes | `stripeWebhookReprocess.ts` | — | High | Corrigé · Vérifié | 94 | Moyenne | Table audit Stripe (si présente) + logs duplicate |
| confirm-paid client | Sync client post-paiement | UI bloquée | `ensureOrderCommissionsReady` ; 503 si commissions KO | `apps/web/app/api/stripe/client/confirm-paid/route.ts` | `20260604120000`, `20260604130000` | High | Corrigé · Vérifié | 95 | Moyenne | Ne pas retirer appel commissions après mark paid |
| confirm-delivery-request-paid | Montant/devise Stripe vs DB | Sous-paiement / fraude | `verifyStripePaidMatchesDeliveryRequest` + guards | `apps/web/app/api/stripe/client/confirm-delivery-request-paid/route.ts`, `verifyStripePaidAmount.ts` | — | Critical | Corrigé · Vérifié | 96 | Moyenne | Tests amount mismatch → 409 |
| Stripe Connect / transfers | Payout sans commissions | Transfert montant faux | `transfers/run` exige `order_commissions` + refresh si absent | `apps/web/app/api/stripe/transfers/run/route.ts` | `20260604120000` | Critical | Vérifié | 94 | Moyenne | 409 `Order commissions required` en monitoring |
| Payouts batch cron | Mode `immediate` vs cron hybride confus | Double payout ou aucun payout | Skip cron si `immediate` ; skip si commissions absentes ; doc modes | `apps/web/app/api/admin/process-payouts/route.ts`, `PAYOUTS_SINGLE_HANDLER.md` | — | High | Corrigé · Vérifié | 93 | Moyenne | `MMD_PAYOUT_MODE` documenté sur Vercel |
| Payouts immédiats | `delivered-confirm` → transfers | Retard restaurant/chauffeur | Flux canonique inchangé (validé) | `apps/web/app/api/orders/delivered-confirm/route.ts` | — | — | Vérifié | 90 | Moyenne | Logs `delivered-confirm` payout trigger |
| Edge payouts | Edge batch actifs | Double handler payouts | `MMD_EDGE_PAYOUTS_DISABLED=true` | `supabase/functions/*_payout*` | — | Critical | Corrigé* · Vérifié | 90 | Faible | Secrets Edge : audit trimestriel |

\* *Déployé = à confirmer en prod par l’équipe ops.*

---

## 2. Commissions

| Domaine | Problème initial | Risque réel | Correction appliquée | Fichiers modifiés | Migration associée | Risque avant | Statut actuel | Score (/100) | Régression ? | Surveillance |
|---------|------------------|-------------|----------------------|-------------------|-------------------|--------------|---------------|--------------|--------------|--------------|
| order_commissions table | Stub / colonnes manquantes | Payouts incorrects | Table complète + colonnes cents | Migrations commissions | `20260604120000_production_payment_commission_hardening.sql` | Critical | Corrigé · Vérifié | 95 | Faible | `\d order_commissions` en prod |
| refresh_order_commissions | Return type void vs jsonb ; DROP trigger par erreur | RPC cassée en prod | DROP **uniquement** 3 signatures RPC ; **jamais** `refresh_order_commissions()` trigger | `20260604130000_fix_refresh_order_commissions_return_type.sql` | `20260604130000` | Critical | Corrigé · Vérifié | 96 | **Élevée** | Ne jamais DROP `refresh_order_commissions()` sans qualifier |
| refresh_order_commissions_rpc | boolean → jsonb | Appels admin cassés | Recréée en jsonb | Idem | `20260604130000` | High | Corrigé · Vérifié | 95 | Moyenne | `select refresh_order_commissions_rpc(uuid)` |
| refresh_order_commissions_for_range | integer → jsonb | Batch repair cassé | Recréée en jsonb | Idem | `20260604130000` | Medium | Corrigé · Vérifié | 94 | Moyenne | Job repair plage dates |
| ensureOrderCommissionsReady | Refresh OK mais ligne absente | Payout sans base | Refresh + SELECT ligne ; logs structurés | `apps/web/src/lib/refreshOrderCommissions.ts` | — | High | Corrigé · Vérifié | 96 | Moyenne | Webhook 500 `order_commissions_refresh_failed` |
| Commissions post-pay webhook | Ignorées après mark paid | Payout bloqué ou forcé sans données | `ensureOrderCommissionsReady` → 500 Stripe retry | `apps/web/app/api/stripe/webhook/route.ts` | — | High | Corrigé · Vérifié | 95 | Moyenne | Métrique webhook ok:false commissions |
| RLS order_commissions | Pas de RLS | Fuite données commissions | RLS + admin / restaurant / driver via `orders` | — | `20260604140000_order_commissions_rls.sql` | High | Corrigé · Vérifié | 94 | Faible | Tests JWT restaurant/driver SELECT |

---

## 3. Commandes Food

| Domaine | Problème initial | Risque réel | Correction appliquée | Fichiers modifiés | Migration associée | Risque avant | Statut actuel | Score (/100) | Régression ? | Surveillance |
|---------|------------------|-------------|----------------------|-------------------|-------------------|--------------|---------------|--------------|--------------|--------------|
| Création web | Commande créée sans tunnel paiement | Commande impayée en prod | Redirect `/orders/{id}?pay=1` | `apps/web/app/orders/new/page.tsx` | — | Critical | Corrigé · Vérifié | 92 | Faible | Parcours web food création |
| Paiement web détail | Pas de bouton paiement | Impayé | `PayButton` + `payment_status` + garde C2 | `apps/web/app/orders/[orderId]/page.tsx`, `PayButton.tsx` | — | Critical | Corrigé · Vérifié | 93 | Moyenne | UI masquée si `paid` |
| Paiement mobile | ClientNewOrderScreen mieux que détail | — | Détail aligné (C1) | `ClientOrderDetailsScreen.tsx` | — | — | Vérifié | 95 | — | — |
| Dispatch food (smart) | `setTimeout` / `after()` vagues 2–3 | Offres perdues | `order_dispatch_wave_schedule` + cron 2 min | `dispatch/smart/route.ts`, `cron/retry-order-dispatch`, `vercel.json` | `20260604150000` | High | Corrigé · Vérifié | 94 | Moyenne | Table `order_dispatch_wave_schedule` pending |
| Dispatch food wave 1 | — | — | Vague 1 synchrone dans POST smart | `dispatch/smart/route.ts` | `20260604150000` | — | Vérifié | 93 | Moyenne | `order_dispatch_attempts` inserts |
| Livraison | pickup/delivered confirm | — | Routes métier existantes (validées) | `pickup-confirm`, `delivered-confirm` | `20260603130000_*` | — | Vérifié | 90 | Moyenne | RPC `confirm_order_*` grants |

---

## 4. Delivery Requests

| Domaine | Problème initial | Risque réel | Correction appliquée | Fichiers modifiés | Migration associée | Risque avant | Statut actuel | Score (/100) | Régression ? | Surveillance |
|---------|------------------|-------------|----------------------|-------------------|-------------------|--------------|---------------|--------------|--------------|--------------|
| Paiement DR webhook | Payé sans release order | Chauffeurs ne voient pas la course | Update `orders.status` waiting_payment → pending | `apps/web/app/api/stripe/webhook/route.ts` | — | High | Vérifié | 92 | Moyenne | Statut order lié après DR paid |
| Paiement DR confirm client | Confirm échoue après webhook paid | Pas de dispatch | Webhook appelle `scheduleDeliveryRequestDispatch` | `webhook/route.ts`, `scheduleDeliveryRequestDispatch.ts` | — | High | Corrigé · Vérifié | 94 | Moyenne | Logs dispatch skipped secret |
| Double dispatch DR | Webhook + confirm → 2× push vague 1 | Spam chauffeurs | `dispatch_wave_1_started_at` verrou UPDATE … IS NULL | `runDeliveryRequestDispatch.ts` | `20260604150000` | High | Corrigé · Vérifié | 96 | Moyenne | Colonne non null après 1er dispatch |
| Offres chauffeur DR | — | — | `delivery_request_driver_offers` idempotent refresh | `createDriverDeliveryRequestOffers.ts` | `20260602210000` | — | Vérifié | 92 | Faible | Doublons offers pending |
| Validation montant Stripe | DR payée montant incorrect | Perte financière | `verifyStripePaidMatchesDeliveryRequest` | `confirm-delivery-request-paid`, `webhook` | — | Critical | Corrigé · Vérifié | 96 | Moyenne | Logs `amount_mismatch` |

---

## 5. Dispatch

| Domaine | Problème initial | Risque réel | Correction appliquée | Fichiers modifiés | Migration associée | Risque avant | Statut actuel | Score (/100) | Régression ? | Surveillance |
|---------|------------------|-------------|----------------------|-------------------|-------------------|--------------|---------------|--------------|--------------|--------------|
| Smart dispatch | Vagues 2–3 via `after()` serverless | Pas de relance | Cron + table schedule | Voir §3 | `20260604150000` | High | Corrigé · Vérifié | 94 | Moyenne | Cron Vercel `*/2 * * * *` actif |
| Retry dispatch cron | N/A | — | `GET/POST /api/cron/retry-order-dispatch` + `CRON_SECRET` | `apps/web/app/api/cron/retry-order-dispatch/route.ts` | `20260604150000` | — | Corrigé · Vérifié | 93 | Faible | Réponse cron `processed` > 0 si backlog |
| Tables dispatch | `order_dispatch_attempts` absent en SQL | Audit impossible | CREATE TABLE + index | — | `20260604150000` | Medium | Corrigé · Vérifié | 95 | Faible | Migration appliquée en prod |
| DR dispatch internal | Secret manquant | Skip silencieux | Log + skip si pas `DISPATCH_INTERNAL_SECRET` | `scheduleDeliveryRequestDispatch.ts` | — | Medium | Vérifié | 90 | Faible | Alerte si log skipped secret |
| Driver order offers | — | — | `driver_order_offers` + smart dispatch | `createDriverOrderOffers.ts` | `20260602160000` | — | Vérifié | 91 | Faible | — |

---

## 6. Authentification

| Domaine | Problème initial | Risque réel | Correction appliquée | Fichiers modifiés | Migration associée | Risque avant | Statut actuel | Score (/100) | Régression ? | Surveillance |
|---------|------------------|-------------|----------------------|-------------------|-------------------|--------------|---------------|--------------|--------------|--------------|
| Signup / login | — (validé contexte) | — | Flux Supabase existants | apps auth routes / mobile | `20260602190000_profiles_insert_own` | — | Vérifié | 88 | Moyenne | RLS profiles |
| Reset password web | Pas de `setSession` sur lien email | Reset impossible web | Parse hash/query + `setSession` + `updateUser` | `apps/web/app/auth/reset-password/page.tsx` | — | High | Corrigé · Vérifié | 92 | Moyenne | Test lien Supabase recovery web |
| Reset password mobile | — | — | `ResetPasswordScreen` setSession (référence) | `apps/mobile/src/screens/ResetPasswordScreen.tsx` | — | — | Vérifié | 90 | — | — |
| Profils / visibilité | Fuite PII participants | — | RLS participant visibility | — | `20260602180000_order_participant_profile_visibility` | Medium | Vérifié | 88 | Faible | — |
| Avatars | — | — | `getAvatarSrc` / storage (existant) | web + mobile libs | — | — | Vérifié | 85 | Faible | — |

---

## 7. Sécurité

| Domaine | Problème initial | Risque réel | Correction appliquée | Fichiers modifiés | Migration associée | Risque avant | Statut actuel | Score (/100) | Régression ? | Surveillance |
|---------|------------------|-------------|----------------------|-------------------|-------------------|--------------|---------------|--------------|--------------|--------------|
| RLS général | Hardening commercial v2 | Élévation privilèges | Migrations 20260603* | multiples | `20260603130000` | High | Vérifié | 90 | Faible | Revue nouvelle table → RLS |
| RLS order_commissions | Absent | Lecture commissions par tout authenticated | Policies scoped | — | `20260604140000` | High | Corrigé · Vérifié | 94 | Faible | — |
| Mapbox geocode | API publique + token exposé | Abus quota / coût | Bearer auth + rate limit ; token serveur only | `mapbox/geocode/route.ts`, `mapboxRouteSecurity.ts` | — | High | Corrigé · Vérifié | 95 | Moyenne | 401 sans Bearer ; mobile `serverGeocode` Bearer |
| Mapbox compute-distance | — | — | Déjà sécurisé (inchangé) | `compute-distance/route.ts` | — | — | Vérifié | 96 | Faible | — |
| Twilio | GET probes en prod | Scan surface | 405 en prod (doc) | voice/sms routes | — | Low | Vérifié* | 88 | Faible | — |
| service_role | Usage API serveur only | — | Pattern `supabaseAdmin` routes | API routes | grants migrations | — | Vérifié | 92 | Moyenne | Jamais exposer service key client |
| Secrets | Hardcodés | — | Env uniquement (validé audit) | — | — | — | Vérifié | 90 | Moyenne | Scan repo secrets CI |

---

## 8. Infrastructure

| Domaine | Problème initial | Risque réel | Correction appliquée | Fichiers modifiés | Migration associée | Risque avant | Statut actuel | Score (/100) | Régression ? | Surveillance |
|---------|------------------|-------------|----------------------|-------------------|-------------------|--------------|---------------|--------------|--------------|--------------|
| Supabase prod | Migrations commissions + dispatch + RLS | RPC/RLS cassés | 4 migrations juin 2026 (voir liste) | `supabase/migrations/20260604*.sql` | 04120000–04150000 | Critical | Corrigé · Vérifié | 94 | Moyenne | Ordre apply documenté READINESS_100 |
| Vercel prod | READY (contexte) | — | Build Next OK | `apps/web` | — | — | Vérifié | 93 | Faible | Build CI sur PR |
| Cron jobs | Payouts hebdo + expire unpaid | — | `process-payouts` (dim) ; `expire-unpaid` ; **+ retry dispatch */2** | `vercel.json` | — | Medium | Corrigé · Vérifié | 92 | Faible | Dashboard Vercel crons 3 entrées |
| Edge Functions | Payouts + webhook dupliqués | Double argent / events | Secrets disable | `supabase/functions/*` | — | Critical | Corrigé* | 90 | Faible | Secrets trimestriel |
| GitHub main | À jour (contexte) | — | — | — | — | — | Vérifié* | 90 | — | PR review registre |
| tsbuildinfo | Risque commit cache | Bruit diff | `.gitignore` `*.tsbuildinfo` | `.gitignore` | — | Low | Corrigé | 100 | Faible | — |

**Ordre migrations prod recommandé**

1. `20260604120000_production_payment_commission_hardening.sql`  
2. `20260604130000_fix_refresh_order_commissions_return_type.sql`  
3. `20260604140000_order_commissions_rls.sql`  
4. `20260604150000_production_dispatch_hardening.sql`  

---

## 9. Mobile

| Domaine | Problème initial | Risque réel | Correction appliquée | Fichiers modifiés | Migration associée | Risque avant | Statut actuel | Score (/100) | Régression ? | Surveillance |
|---------|------------------|-------------|----------------------|-------------------|-------------------|--------------|---------------|--------------|--------------|--------------|
| Android | Build EAS prod keys | — | `app.config.ts` guards pk_live | `app.config.ts` | — | — | Vérifié | 88 | Moyenne | EAS production profile |
| iOS | Associated domains | — | applinks mmddelivery.com | `app.config.ts` | — | — | Vérifié | 88 | Moyenne | AASA TEAMID en prod |
| Deep links | scheme mmddelivery | — | Navigator reset-password paths | `AppNavigator.tsx` | — | — | Vérifié | 90 | Faible | — |
| Universal links | OK (contexte) | — | web `public/.well-known/*` | `apps/web/public` | — | — | Vérifié* | 85 | Moyenne | assetlinks SHA256 Play |
| Geocode API auth | Cassé après H5 | Setup restaurant | `getMapboxAuthHeaders` dans geocode | `serverGeocode.ts` | — | Medium | Corrigé · Vérifié | 94 | Faible | Session requise |
| PaymentSheet | Voir §1 C1 | — | — | `ClientOrderDetailsScreen.tsx` | — | Critical | Corrigé · Vérifié | 98 | Élevée | — |
| TypeScript mobile | — | — | `tsc --noEmit` pass | — | — | — | Testé (build) | 95 | Faible | CI tsc |

---

## 10. Readiness commerciale

| Domaine | Problème initial | Risque réel | Correction appliquée | Fichiers modifiés | Migration associée | Risque avant | Statut actuel | Score (/100) | Régression ? | Surveillance |
|---------|------------------|-------------|----------------------|-------------------|-------------------|--------------|---------------|--------------|--------------|--------------|
| App Store URL | Placeholder générique | Mauvaise conversion referral | Env `NEXT_PUBLIC_APP_STORE_URL` + fallback `/download` | `apps/web/app/r/[code]/page.tsx` | — | Medium | Corrigé · Vérifié | 70 | Faible | URL réelle avant soumission |
| Play Store URL | Idem | Idem | Env `NEXT_PUBLIC_PLAY_STORE_URL` | Idem | — | Medium | Corrigé · Vérifié | 70 | Faible | Idem |
| Pages légales | Absentes web | Rejet store | `/legal/privacy`, `/terms`, `/support` | `apps/web/app/legal/*` | — | High | Corrigé · Vérifié | 85 | Faible | Contenu juridique validé par counsel |
| Privacy URL mobile | Texte in-app seulement | — | `EXPO_PUBLIC_LEGAL_PRIVACY_URL` dans extra | `app.config.ts` | — | Medium | Corrigé · Vérifié | 82 | Faible | Lier écrans légaux mobile aux URLs |
| Terms / Support | — | — | URLs extra + pages web | `app.config.ts`, legal pages | — | Medium | Corrigé · Vérifié | 82 | Faible | — |
| Smoke test E2E | Non exécuté | Régression non détectée | Checklist `READINESS_100_CHECKLIST.md` | docs | — | High | Corrigé (doc) | 40 | — | Sign-off ops obligatoire |
| Soumission stores | Non faite | Pas en production stores | — | — | — | High | Non démarré | 30 | — | App Store Connect / Play Console |

---

# Synthèse — 4 tableaux

## TABLEAU A — 100 % terminé (code + doc, prêt référence)

| ID | Élément | Domaine |
|----|---------|---------|
| A1 | Anti double paiement PaymentSheet → Checkout (C1) | Paiements |
| A2 | Garde PI Checkout `payment_already_succeeded` / in progress (C2) | Paiements |
| A3 | Webhook duplicate reprocess + commissions manquantes (H2) | Paiements |
| A4 | `ensureOrderCommissionsReady` webhook + confirm-paid (H1) | Commissions |
| A5 | Migrations RPC commissions jsonb (sans DROP trigger) | Commissions |
| A6 | RLS `order_commissions` | Commissions / Sécurité |
| A7 | Verrou dispatch DR vague 1 | Delivery Requests |
| A8 | Cron retry dispatch vagues 2–3 (DB schedule) | Dispatch |
| A9 | Tables `order_dispatch_attempts` + `order_dispatch_wave_schedule` | Dispatch |
| A10 | Mapbox geocode auth + mobile Bearer | Sécurité |
| A11 | Reset password web `setSession` | Auth |
| A12 | PayButton web + `?pay=1` food | Food |
| A13 | Pages légales web + URLs `app.config` extra | Commercial |
| A14 | Payout mode doc + cron immediate skip | Payouts |
| A15 | `.gitignore` tsbuildinfo | Infra |
| A16 | Builds `mmd-web` + tsc web/mobile (dernière passe) | Infra |

---

## TABLEAU B — Terminé mais à surveiller

| ID | Élément | Risque régression | Action surveillance |
|----|---------|-------------------|---------------------|
| B1 | `refresh_order_commissions()` trigger — ne pas DROP | Élevée | Review SQL toute migration touchant `refresh_order_commissions` |
| B2 | Flux `handlePay` mobile | Élevée | QA checklist paiement chaque release mobile |
| B3 | `create-checkout-session` garde PI | Moyenne | Test API automatisé si possible |
| B4 | Webhook 500 commissions → retry Stripe | Moyenne | Alerting sur `order_commissions_refresh_failed` |
| B5 | Cron dispatch 2 min | Moyenne | Vercel cron logs ; pending rows > 0 |
| B6 | `MMD_PAYOUT_MODE` | Moyenne | Documenter changement env avant deploy |
| B7 | Edge secrets disable | Faible | Audit secrets Supabase trimestriel |
| B8 | Universal links AASA / assetlinks | Moyenne | Valider après changement certificat signing |
| B9 | DR dispatch secret manquant | Faible | Log `[scheduleDeliveryRequestDispatch] skipped` |

---

## TABLEAU C — Dépend d’actions opérationnelles (pas le code seul)

| ID | Action | Responsable | Bloque 100/100 ? |
|----|--------|-------------|------------------|
| C1 | Appliquer migrations `20260604120000` → `04150000` en Supabase prod | Ops / DBA | Oui (prod) |
| C2 | Déployer Vercel (web + `vercel.json` crons) | Ops | Oui (prod) |
| C3 | Confirmer secrets : Stripe Live webhook, `CRON_SECRET`, `DISPATCH_INTERNAL_SECRET`, `MAPBOX_ACCESS_TOKEN` | Ops | Oui |
| C4 | `MMD_EDGE_PAYOUTS_DISABLED` + `MMD_STRIPE_WEBHOOK_DISABLED` Edge | Ops | Oui |
| C5 | Smoke test signé : pay → livraison → payout (`READINESS_100_CHECKLIST.md`) | QA / Product | Oui (commercial) |
| C6 | URLs App Store / Play réelles dans Vercel env | Product | Oui (commercial) |
| C7 | Soumission + approbation App Store / Play | Product | Oui (commercial) |
| C8 | Revue juridique textes `/legal/*` | Legal | Recommandé |
| C9 | Remplacer TEAMID / SHA256 universal links | Ops | Recommandé |

---

## TABLEAU D — Feuille de route améliorations futures

| Priorité | Amélioration | Bénéfice |
|----------|--------------|----------|
| P1 | Suite E2E Playwright (web pay + order status) | Fermer gap smoke automatisé |
| P2 | Tests API intégration Stripe (mode test) CI | Régression C1/C2 |
| P3 | Écrans mobile liés à `EXPO_PUBLIC_LEGAL_*_URL` (WebView) | Parité stores |
| P4 | Idempotency key Stripe Checkout par `order_id` | Renforcer anti-double |
| P5 | Dashboard alerting (webhook failures, commissions, cron dispatch) | Ops proactif |
| P6 | `delivery_request_dispatch_attempts` table (symétrie orders) | Audit DR |
| P7 | Paiement inline sur `/orders/new` (optionnel) | UX commercial |
| P8 | Review juridique FR/EN pages légales | Conformité |

---

# Scores et verdict

## Production Readiness actuel

| Composant | Score |
|-----------|-------|
| Paiements & Stripe | 96 |
| Commissions & RLS | 95 |
| Commandes & DR | 93 |
| Dispatch & cron | 94 |
| Auth & sécurité API | 93 |
| Infra (migrations prêtes) | 94 |
| **Moyenne pondérée Production** | **94 / 100** |

*Hypothèse : correctifs dans le dépôt, **migrations non encore toutes appliquées en prod** (−4), crons pas observés en prod (−2).*

## Commercial Readiness actuel

| Composant | Score |
|-----------|-------|
| Parcours paiement client (code) | 93 |
| Pages légales & metadata (code) | 82 |
| Stores (soumission) | 35 |
| Smoke / E2E signé | 40 |
| **Moyenne pondérée Commercial** | **78 / 100** |

## Production Readiness maximal atteignable avec le code actuel

**98 / 100** — après application des 4 migrations prod, deploy Vercel, secrets confirmés, et 1 smoke technique signé. Les 2 points restants : observabilité/alerting non codés + dépendance process humain release.

## Commercial Readiness maximal atteignable avec le code actuel

**92 / 100** — avec pages légales déployées, parcours web/mobile pay validé en Live, URLs stores réelles. **Pas 100** sans approbation App Store + Play et counsel juridique.

## Ce qui manque exactement pour 100/100

| # | Manquant | Type |
|---|----------|------|
| 1 | Migrations `04130000`, `04140000`, `04150000` appliquées en Supabase production | Ops |
| 2 | Deploy Vercel incluant cron `retry-order-dispatch` | Ops |
| 3 | Smoke test documenté **exécuté et signé** (pay → delivered → payout) | QA |
| 4 | `NEXT_PUBLIC_APP_STORE_URL` / `PLAY_STORE_URL` réelles + apps soumises | Product |
| 5 | Revue juridique contenu légal | Legal |
| 6 | (Optionnel 100 strict) E2E automatisés en CI | Engineering |

---

## Verdict registre

| Verdict | État |
|---------|------|
| **Référence technique production (code)** | **OUI** — ce document fait foi pour les mises à jour futures. |
| **READY FOR FULL COMMERCIAL PRODUCTION 100/100** | **NON** — bloqué par Tableau C (ops + stores + smoke signé). |
| **Prêt commit / deploy code** | **OUI** — sous réserve application Tableau C. |

---

## Procédure obligatoire avant chaque release future

1. Lire ce registre + `READINESS_100_CHECKLIST.md`.  
2. Vérifier qu’aucune migration ne DROP `refresh_order_commissions()` sans signature.  
3. Exécuter `pnpm --filter mmd-web build` + `tsc` web/mobile.  
4. QA minimale : C1 mobile, C2 web, 1 DR dispatch, 1 payout commissions.  
5. Mettre à jour **TABLEAU A/B** de ce fichier si nouveau correctif.

---

*Document généré pour MMD Delivery — registre officiel v2026-06-04. Aucune modification de code applicatif ; documentation seule.*
