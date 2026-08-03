# Rapport — Connexion Vercel projet officiel MMD Delivery

**Date :** 2026-08-03  
**Demande :** Lier le CLI au vrai projet MMD ; **ne pas** exécuter le cutover PE.  
**Compte CLI :** `diallomamadoumaladho62102-beep`

---

## 1. Projet actuellement utilisé

| Champ | Valeur |
|---|---|
| **Nom projet** | `mmd-delivery` |
| **Project ID** | `prj_pqVe0VOpRFa9YZDxZTa69JccOul6` |
| **Org / team** | `diallomamadoumaladho62102-beeps-projects` (`team_kesYZV5bRfjiCKKqQ25v2A6D`) |
| **Root Directory** | `apps/web` |
| **Production URL (liste projets)** | `https://www.mmddelivery.com` |
| **Lien local** | `C:\DEV\MMD-Delivery\.vercel\project.json` → `mmd-delivery` |

### Sandbox corrigé

| Avant | Action | Après |
|---|---|---|
| `apps/web/.vercel` → projet **`web`** (créé aujourd’hui, 0 env) | **Supprimé** | Plus de lien sandbox sous `apps/web` |
| Racine → parfois ambigu | `vercel link --project mmd-delivery --yes` | Lien officiel **`mmd-delivery`** |

---

## 2. Est-ce le projet officiel MMD ?

| Critère | Résultat |
|---|---|
| Nom `mmd-delivery` | **Oui** |
| URL prod listée `https://www.mmddelivery.com` | **Oui** |
| Root Directory `apps/web` (monorepo) | **Oui** |
| Déploiements Production **Ready** récents (même compte) | **Oui** |
| Projet sandbox `web` | **Non officiel** — délié |

**Verdict :** **Oui — c’est le projet Vercel officiel MMD Delivery.**

---

## 3. Accès disponibles

| Capacité | Statut | Preuve |
|---|---|---|
| Authentification CLI | **OK** | `vercel whoami` |
| Lecture métadonnées projet | **OK** | `vercel project inspect mmd-delivery` |
| Liste déploiements | **OK** | `vercel ls mmd-delivery` (Production Ready + Preview) |
| Liste variables d’environnement (noms) | **OK** | `vercel env ls` — nombreuses vars (Stripe, Supabase, Twilio, Marketplace flags, etc.) |
| Valeurs env (décryptées) | **Non affichées** (volontaire — Encrypted) | CLI montre `Encrypted`, pas les secrets |
| Consultation `PRICING_ENGINE_*` | **OK (résultat : absentes)** | Aucune clé `PRICING_ENGINE_*` en Production / Preview / liste globale |
| Modification env (`vercel env add` / `rm`) | **CLI disponible** sur ce compte/projet | Help + propriétaire des déploiements = ce username |
| Redéploiement (`vercel deploy` / `--prod`) | **CLI disponible** | Commande accessible ; **non exécuté** (demande explicite) |

---

## 4. Variables `PRICING_ENGINE_*`

| Environnement | Présentes ? |
|---|---|
| Production | **Non** |
| Preview | **Non** |
| Development (liste globale) | **Non** |

Conséquence : aujourd’hui le runtime utilise les **defaults code** → `charge_path = legacy`.  
Le cutover pourra poser ces variables **une fois autorisé** (pas dans cette étape).

---

## 5. Cutover PE — pourra-t-il être exécuté ensuite ?

| Condition | État |
|---|---|
| Bon projet lié | **Oui** |
| Lecture env | **Oui** |
| Écriture env PE (quand autorisée) | **Oui (capable)** — non faite |
| Redeploy après env | **Oui (capable)** — non fait |
| Autorisation cutover | **Pas encore** (vous avez demandé de s’arrêter ici) |

**Réponse :** **Oui**, le cutover pourra être exécuté depuis ce CLI **après votre feu vert**, en posant les `PRICING_ENGINE_*` sur `mmd-delivery` (staging/Preview puis Production) + redeploy — sans retomber sur le sandbox `web`.

---

## 6. Action de votre part ?

**Aucune authentification supplémentaire requise** pour ce compte : le CLI est déjà sur le bon projet.

Optionnel (recommandé) :
1. Confirmer dans le dashboard Vercel que `mmd-delivery` → Domains inclut bien `www.mmddelivery.com` / `mmddelivery.com` (la CLI liste déjà cette URL prod).
2. Quand vous serez prêt : autoriser explicitement **« Cutover PE — APPROUVÉ »** (Preview d’abord, puis Production).

---

## 7. Non fait (conformément à la demande)

- Aucun ajout / modification de `PRICING_ENGINE_*`
- Aucun redéploiement
- Aucun cutover charge

---

*Rapport connexion Vercel MMD — 2026-08-03 — cutover non démarré.*
