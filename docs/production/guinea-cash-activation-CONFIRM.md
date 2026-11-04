# Guinée CASH — SQL à confirmer avant application prod

**Projet lié :** `sjmszohmhudayxawfows.supabase.co` (distant / partagé).  
**Statut :** **NON APPLIQUÉ** (activation restaurant + colonnes `payment_method`). Attente de votre confirmation explicite.

Aucune donnée US n’est touchée (`WHERE country_code = 'GN'` pour les flags).  
Aucune approbation artificielle de comptes `guinea-*@example.com`.

---

## Sonde lecture seule (2026-11-04)

| Contrôle | Résultat live |
|---|---|
| `seller_orders` `pending_cash` / `cash_collected` | **Déjà autorisé** (CHECK élargi ou absent) — A idempotent |
| `delivery_requests.payment_method` | **ABSENT** — B obligatoire |
| `orders.payment_method` | **ABSENT** — B obligatoire |
| `taxi_rides.payment_method` | Présent |
| `delivery_requests` / `orders` `payment_status` cash | Déjà accepté (pas de CHECK bloquant) |
| Flags GN | `platform/taxi/delivery/marketplace/seller/checkout = true` ; **`restaurant_enabled = false`** |
| Flags US | Intacts (`restaurant_enabled = true`, etc.) |

---

## Ordre d’exécution recommandé

1. **A** `supabase/pending/20261223120000_marketplace_local_cash.sql` (idempotent)
2. **B** `supabase/pending/20261224120000_guinea_local_cash_delivery_food.sql` (**critique** — ajoute `payment_method`)
3. **C** `docs/production/guinea-public-activation.sql` (ré-applique A/B + active `restaurant_enabled` et zones GN)

Ou exécuter **uniquement C** (il contient déjà A+B + flags). Préférer A → B → C pour contrôles intermédiaires.

### A. Schéma cash Marketplace

Fichier : `supabase/pending/20261223120000_marketplace_local_cash.sql`

**Effets :** autorise `pending_cash` / `cash_collected` sur `seller_orders`.  
**Risque :** faible ; idempotent ; ne change aucune ligne existante.

### B. Schéma cash Colis + Restaurant (food orders)

Fichier : `supabase/pending/20261224120000_guinea_local_cash_delivery_food.sql`

**Effets :** colonnes `payment_method` nullables + CHECKs ; drop de CHECKs `payment_status` trop stricts s’ils existent.  
**Risque :** faible ; `IF NOT EXISTS` / drop+add check idempotent.  
**US :** lignes existantes restent `payment_method = null` ; Stripe inchangé.

### C. Activation publique 4 services GN

Fichier : `docs/production/guinea-public-activation.sql`

**Effets :**
- Réapplique A+B + `restaurant_profiles.country_code` (+224 → GN)
- `platform_countries` / `platform_regions` / `taxi_countries` **GN only** → taxi, delivery, restaurant, marketplace, seller, checkout ON
- Live Stripe marketplace / payouts restent **OFF**
- **Ne touche pas** US / CA / autres pays

---

## Contrôles après application (à exécuter après votre OK)

```bash
node docs/production/tools/probe-guinea-cash-schema.mjs
node docs/production/tools/probe-payment-status-cash.mjs
```

Attendu :
- `delivery_requests_payment_method.exists = true`
- `orders_payment_method.exists = true`
- `gnFlags.row.restaurant_enabled = true`
- `usFlags` inchangé

---

## ENV (hors SQL) — après votre OK activation

```
GUINEA_MARKET_ENABLED=true
MARKETPLACE_CHECKOUT_ENABLED=true
# ORANGE_MONEY_GN_ENABLED : false / absent jusqu’aux vrais credentials
# STRIPE_ENABLED_GN : false
```

Ne **pas** approuver `guinea-client|driver|seller|restaurant@example.com` pour le live.

---

## Phrase d’autorisation attendue

Répondez explicitement, par exemple :

> **Applique A+B+C sur Supabase sjmszohmhudayxawfows et active restaurant_enabled GN.**

Sans cette phrase, **aucune** migration / activation prod ne sera exécutée.
