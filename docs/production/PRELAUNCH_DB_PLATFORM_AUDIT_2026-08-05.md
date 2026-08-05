# Audit final plateforme & base — 2026-08-05

Projet prod : `sjmszohmhudayxawfows` · Compute : **Micro** (conservé)  
Branche / migrations : `20261107120000` (rétention) + `20261107140000` (orphelins + rétention étendue)

## 0. Validations déjà acceptées

- Nettoyage `cron.job_run_details`, cron payout dupliqué retiré, rétention active
- Taille DB ≠ problème ; upgrade Micro **non justifié** tant que saturation durable absente
- Dossiers **Disk I/O GPS** et **Sentry MOBILE-A** restent **en observation** (hors clôture)

---

## 1. Inventaire des traitements automatiques

### 1.1 pg_cron (actifs)

| Nom | Fréquence | Objectif métier | Coût | Indispensable | Optimisable |
|-----|-----------|-----------------|------|---------------|-------------|
| `mmd-dispatch-fallback-every-minute` | `* * * * *` | Retry dispatch Food + Delivery | Élevé (historique) | **Oui** | Historique purgé 7j ; cadence métier à garder |
| `mmd-finance-hourly` | `25 * * * *` | Finance batch / balances | Faible | Oui (ops finance) | Peut rester hourly |
| `mmd-analytics-hourly` | `15 * * * *` | Refresh analytics daily metrics | Faible | Utile | OK |
| `mmd-db-daily-maintenance` | `20 5 * * *` | Expire loyalty/benefits/subs + taxi snapshot | Moyen | Oui | Déjà consolidé |
| `weekly_driver_payouts` | `0 9 * * 1` | Planification payouts chauffeurs | Faible | Oui | Doublon `*_create` **supprimé** |
| `mmd-observability-retention-daily` | `10 6 * * *` | Purge journaux techniques | Faible | Oui | — |

### 1.2 Vercel Cron (`vercel.json`)

| Path | Schedule | Objectif |
|------|----------|----------|
| `/api/cron/daily-money` | `15 4 * * *` | Fan-out : expire-stale-payments, taxi/marketplace payouts, process-payouts |
| `/api/cron/daily-ops` | `30 5 * * *` | Fan-out : vehicle-eligibility, expire-mmd-plus, expire-marketing, site-cms-promote |

Routes `/api/cron/*` restantes = invocation manuelle / ops / héritage ; **non planifiées** sur Hobby sauf via les 2 orchestrateurs.

Routes ops/dev (auth CRON_SECRET, non planifiées Vercel) :

- `infra-probe` — sonde infra (garder pour ops)
- `twilio-video-selftest` — self-test manuel (garder, pas de schedule)

### 1.3 Edge Functions (Supabase)

Pas de schedules déclarés dans `config.toml` pour road-safety ingest périodique côté config locale. Functions conservées (webhook/paiement/push/connect) :

`stripe_webhook`, `confirm_checkout_session`, `create_payment_intent`, `create_connect_account`, `check_connect_status`, `sync_connect_status`, `sync_restaurant_connect_status`, `stripe_driver_onboarding`, `pay-driver-now`, `pay_restaurant_now`, `pay_restaurant_scheduled`, `process_driver_payouts`, `weekly_restaurant_payout`, `send_driver_push`, `send_restaurant_push`, `restaurant-connect-link`, `translate_message`, `road-safety-events`, `road-safety-ingest-osm`, `road-safety-ingest-scheduled`

→ **Aucune Edge Function de test/dev désactivée automatiquement** (doute = conservation).

### 1.4 Triggers SQL importants

Conservés (métier) : normalisation documents, skip noop `driver_locations`, RLS/updated_at divers.  
**Aucun trigger obsolète supprimé** (certitude insuffisante).

### 1.5 Mutualisation

Déjà en place : daily-money / daily-ops (Vercel) + mmd_cron_* (pg_cron).  
Dispatch minute reste séparé (latence). Pas de fusion supplémentaire recommandée avant launch.

---

## 2. Données — candidats & actions

### 2.1 Comptes par `account_kind`

| Kind | Count | Action |
|------|------:|--------|
| real | 28 | Conservés |
| certification | 5 | **Conservés** (4 admins `+cert-*` + 1 e2e enterprise) — utiles smoke rôles |
| test | 2 | **Conservés** (`e2e.*@mmd.test`) — historique certification possible |

### 2.2 Orphelins `profiles` sans `auth.users` — **supprimés**

| Email / id | Raison |
|------------|--------|
| `qa-vehicle-rls-*@example.com` (×3) | Débris QA RLS, 0 commandes / tokens / adresses |
| `306ef52d-…` restaurant sans email | Husk sans auth / sellers / orders |

### 2.3 Non supprimé (doute / utilité)

- Comptes `+cert-ops|finance|support|review@gmail.com`
- Clients `@mmd.test`
- Toute commande / taxi / DR / payout / wallet / payment

### 2.4 Doublons

| Check | Résultat | Stratégie |
|-------|----------|-----------|
| Emails profiles | Aucun | — |
| Documents chauffeur (user+type) | Aucun | — |
| Adresses client exactes | N/A schéma (pas de formatted_address unique scan) | Surveiller via UI |
| Index unused (`idx_scan=0`) | Nombreux petits index / contraintes | **Ne pas drop** : unicité / readiness launch |

Origine orphelins QA : scripts RLS véhicule (juillet 2026) ayant laissé des rows `profiles` après delete auth.

---

## 3. Politique de rétention (automatique)

Fonction `public.mmd_purge_observability_retention()` + cron quotidien :

| Table | Rétention |
|-------|-----------|
| `cron.job_run_details` | 7 jours |
| `auth.audit_log_entries` | 30 jours |
| `notification_logs` | 90 j / archivées 30 j |
| `road_safety_events` | expirés ; inactifs 90 j |
| `stripe_webhook_events` | 90 j (`received_at`) |
| `ai_events` | 90 j |
| `call_sessions` | 90 j |

**Non purgé automatiquement :** `location_points` (adresses utilisateur), `admin_audit_logs` (compliance), ledgers finance, orders, wallets.

---

## 4. Objets PostgreSQL

### Extensions (toutes utiles — conservées)

`pg_cron`, `pg_net`, `pg_stat_statements`, `pg_trgm`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`

### Fonctions / vues / triggers / index

- **0** fonction/RPC/vue/trigger/index droppé
- Index `idx_scan=0` documentés uniquement (risque de casser contraintes / chemins rares)

---

## 5. Espace disque (top)

| Relation | Taille rapportée | Note |
|----------|------------------|------|
| `cron.job_run_details` | ~25 MB | ~10k live rows post-purge ; espace mort jusqu’à VACUUM dashboard |
| `auth.audit_log_entries` | ~1.6 MB | rétention 30j |
| `notification_logs` | ~1.3 MB | OK |
| `road_safety_events` | ~1 MB | OK |
| Reste métier | &lt; 500 kB / table | OK |

DB totale ~**73–90 MB**. VACUUM via Management API impossible (transaction) → exécuter `VACUUM (ANALYZE) cron.job_run_details;` dans SQL Editor si compactage UI souhaité.

---

## 6. Optimisations réalisées (cette passe)

1. Migration rétention étendue + purge one-shot
2. Suppression **4** profils orphelins QA/husk
3. Inventaire automatismes documenté
4. Confirmation Micro suffisant

### Non réalisé (volontaire)

- Suppression comptes certification / e2e
- Drop index « unused »
- Disable Edge Functions
- Changer cadence dispatch minute
- Modifier paiements / wallets / orders

---

## 7. Non-régression

| Domaine | Statut |
|---------|--------|
| Paiements / wallets / orders | Non touchés |
| Rôles staff +cert | Conservés |
| APIs métier | Pas de changement de contrat |
| Retention | Uniquement journaux techniques |

Vérifs post-migration recommandées Founder : login chauffeur réel, 1 lecture admin Clients, cron dispatch toujours `active=true`.

---

## 8. Recommandations croissance

1. Surveiller taux upserts `driver_locations` vs baseline (dossier I/O ouvert)
2. Quand Observability CPU/IOPS revient : alerter si Disk IO Budget &gt; 0 durablement
3. Après launch : décision Founder sur archivage comptes `+cert-*` / `@mmd.test`
4. Ne monter compute que sur saturation **mesurée** (pas sur RAM cache ~90 %)

---

## 9. Verdict launch readiness (DB/ops)

| Critère | Verdict |
|---------|---------|
| Propreté journaux techniques | **OK** (rétention) |
| Orphelins QA évidents | **Nettoyés** |
| Automatismes documentés | **OK** |
| Upgrade Micro | **Non** |
| Clôture Disk I/O GPS / Sentry A | **Non** (observation) |
| Suppression agressive test e2e | **Reportée** (validation Founder) |
