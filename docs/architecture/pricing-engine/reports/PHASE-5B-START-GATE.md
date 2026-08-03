# Phase 5B — Independence — START-GATE

**Date :** 2026-08-03  
**Type :** START-GATE  
**Statut :** `APPROUVÉ AVEC AMENDEMENTS` (2026-08-03) — implémentation livrée  
**Amont validé :** [`PHASE-6-CLOSURE-ROADMAP.md`](./PHASE-6-CLOSURE-ROADMAP.md) — **`APPROUVÉ`** (2026-08-03)  
**Constat amont :** [`PHASE-6-HARD-GATE-PROOF.md`](./PHASE-6-HARD-GATE-PROOF.md) — **`NO GO`** (critère P4)  
**Gouvernance :** START-GATE → Approbation → Implémentation → Completion → Validation  
**Completion :** [`PHASE-5B-COMPLETION.md`](./PHASE-5B-COMPLETION.md) — en attente **`Phase 5B — VALIDÉ`** (pas de START-GATE 5C avant)  

### Amendements fondateur (2026-08-03) — faisant foi

1. Verticales : **Ride**, **Food**, **Package**, **Marketplace** — Engine = seule SoT de calcul.  
2. Legacy peut rester physiquement ; **plus** de logique métier / formule exécutée par le legacy sur le chemin engine.  
3. Hors scope inchangé : pas de suppression legacy / flags / Kill Switch / Shadow / wrappers / cleanup (→ Phase 6).  
4. Completion doit prouver **par verticale** : SoT Engine, aucune dépendance métier legacy, aucune formule legacy exécutée, résultats = attentes fonctionnelles, preuves techniques.  
5. Pendant 5B : **aucun** changement comportement utilisateur / régression / prix / paiements / reversements en production (indépendance code uniquement).

---

## 1. Objectif de la phase

Faire du **Pricing Engine** la **seule source de vérité de calcul** pour les surfaces déjà sous dual-path (et toute surface explicitement incluse dans le scope 5B).

### Ce que « Independence » signifie

| Signifie | Ne signifie **pas** |
|---|---|
| Le montant chargeable est produit par le moteur (Rate/Fee + assemble), **sans** dépendre d’un pré-calcul legacy comme vérité | Suppression du code legacy |
| Les adapters Engine **ne sont plus** des wrappers de parité autour du legacy | Suppression des Feature Flags |
| Le legacy peut rester **sur disque** / importable, mais **n’est plus** la source de calcul utilisée pour charge | Suppression Kill Switch / Shadow |
| Les chemins `select*ChargePath` peuvent encore basculer legacy↔engine via flags | Cutover production à 100 % (→ **5D**) |
| | Couverture de **toutes** les surfaces (→ **5C**) |
| | Nouveau Hard Gate GO (→ **5E**) |
| | Cleanup définitif (→ **Phase 6**) |

**Posture cible fin 5B :** *« Le moteur calcule ; le legacy peut exister mais n’est plus nécessaire pour produire un quote/charge engine. »*

---

## 2. Problème actuel (preuve Hard Gate)

Extrait du NO GO — critère **P4** :

Les adapters Engine (`foodAdapter`, `packageAdapter`, `taxiAdapter`, `marketplaceAdapter`) appellent encore les helpers legacy (`computeFoodOrderServerPricing`, `computeDeliveryPricing`, `computeTaxiFinalPrice`, etc.) puis **réassemblent** le même résultat pour « engine ».

Conséquence : même avec `PRICING_ENGINE_CHARGE_*=1`, la vérité de calcul reste le moteur historique — le PE n’est pas indépendant.

---

## 3. Périmètre — IN SCOPE

### 3.1 Indépendance des adapters Engine (cœur 5B)

Rendre le chemin **engine** autonome pour :

| Surface | Adapter / module | Legacy aujourd’hui (à cesser d’utiliser comme SoT engine) |
|---|---|---|
| Food | `apps/web/src/lib/pricingEngine/engine/adapters/foodAdapter.ts` | `computeFoodOrderServerPricing` + assemble |
| Package | `…/packageAdapter.ts` | `computeDeliveryPricing` + assemble |
| Taxi | `…/taxiAdapter.ts` | `computeTaxiFinalPrice` / helpers taxi + assemble |
| Marketplace | `…/marketplaceAdapter.ts` | `computeMarketplaceCheckout` + assemble |

**Travail attendu (après approbation uniquement) :**

1. Définir / utiliser le calcul Engine **propre** (Rate/Fee Engine + règles ADR déjà livrées) pour produire `engine` quote **sans** appeler le helper legacy comme source des montants.
2. Conserver `legacy` quote **séparément** pour Shadow Compare / fail-open / rollback (le legacy peut encore être calculé **en parallèle** pour comparaison — ce n’est pas la SoT du chemin charge engine).
3. Garantir que `select*ChargePath` sur `charge_path=engine` utilise uniquement le quote `engine` indépendant.
4. Documenter toute divergence intentionnelle vs legacy (et stratégie de parité / tolérance — sans changer les formules métier hors gate).

### 3.2 Contrats & invariants (non négociables)

- **Jamais** recalculer un Quote Snapshot déjà persisté.
- **Jamais** muter le prix d’une commande déjà créée.
- Respecter ADR-001 (SRP, interfaces, engines séparés).
- **Pas** de nouvelle feature Pricing Engine hors bug critique / sécu.
- Compatibilité arrière des payloads API publics (sauf décision explicite hors 5B).

### 3.3 Preuves / livrables 5B

| Livrable | Description |
|---|---|
| Implémentation adapters indépendants | Code : engine path sans SoT legacy |
| Rapport `PHASE-5B-COMPLETION.md` | Preuve technique + inventaire fichiers touchés |
| Preuve d’indépendance | Checklist : aucun import « SoT » legacy dans le chemin engine charge |
| Parité / écarts | Tableau des écarts restants (si) + justification |
| Tests | Unit / intégration ciblés adapters + charge path engine |
| Rollback doc | Comment revenir à charge legacy via flags (inchangé) |

---

## 4. Périmètre — OUT OF SCOPE (explicitement)

| Exclu de 5B | Phase propriétaire |
|---|---|
| Brancher `select*` sur **tous** les creates (Food/Package/Taxi create sans select) | **5C** |
| Marketplace / Quotes / Checkouts / surfaces restantes non encore sous PE | **5C** |
| Activation progressive prod, canary %, métriques ops cutover | **5D** |
| Nouvel audit Hard Gate P1–P5 → GO/NO-GO | **5E** |
| Suppression code legacy, wrappers, flags migration, Kill Switch, Shadow | **Phase 6** (après 5E GO) |
| Settlement / payouts / crons (déjà hors Hard Gate charge) | Hors programme PE charge |
| Changement d’architecture ADR / nouvelles formules produit | Interdit (sauf gate dédié) |
| Modification flags **production** sans gate 5D | Interdit en 5B |

**Clarification :** 5B peut toucher le code des adapters et tests ; **ne doit pas** supprimer le legacy ni désactiver Kill Switch / Shadow / fail-open.

---

## 5. Interdits absolus (pendant et après 5B jusqu’à Phase 6)

Conformément à l’approbation fondateur (2026-08-03) :

- ❌ Suppression du moteur historique  
- ❌ Suppression des Feature Flags de migration  
- ❌ Suppression du Kill Switch  
- ❌ Suppression du Shadow Compare  
- ❌ « Simplification » qui retire le dual-path / fail-open  

Ces actions restent **réservées à la Phase 6**, après **5E GO** + START-GATE Phase 6 + approbation explicite.

---

## 6. Approche technique proposée (pour examen — non exécutée)

### 6.1 Principe

```
Aujourd’hui (NO GO P4):
  request → legacyCompute() → assemble(legacy) + assemble(engine≈legacy) → select(flag)

Cible 5B:
  request → engineCompute()  → quote engine (SoT charge si flag engine)
           → legacyCompute() → quote legacy (shadow / fallback uniquement)
           → select(flag) / kill / fail-open inchangés
```

### 6.2 Ordre de travail suggéré (post-approbation)

1. **Food adapter** — plus critique (pilot live Fouta) ; prouver indépendance + tests.  
2. **Package adapter** — même pattern delivery fee.  
3. **Taxi adapter** — final price / surge / wait si applicable.  
4. **Marketplace adapter** — checkout compose (sans exiger Connect sellers).  
5. Rapport completion + preuve d’indépendance par surface.

### 6.3 Stratégie de parité

- Pendant 5B : viser **parité numérique** avec le legacy sur les cas de test existants (shadow / golden), sauf écart documenté et approuvé.
- Si un écart est inévitable pour « vraie » indépendance : le documenter dans COMPLETION ; **ne pas** forcer un cutover prod (5D).
- Shadow Compare reste actif pour détecter les régressions.

### 6.4 Flags / Kill Switch (inchangés en 5B)

| Mécanisme | Action 5B |
|---|---|
| `PRICING_ENGINE_CHARGE_*` | **Aucun** changement de défaut ; pas d’obligation d’activer en prod |
| Kill Switch | **Conservé** |
| Shadow | **Conservé** (encore plus utile pendant indépendance) |
| Fail-open → legacy | **Conservé** |

L’indépendance du code engine **ne force pas** le trafic charge sur engine — c’est **5D**.

---

## 7. Risques & mitigation

| Risque | Mitigation |
|---|---|
| Divergence de prix Food/Package/Taxi vs legacy | Golden tests + shadow ; ne pas activer charge engine en prod tant que 5D |
| Régression pilot Fouta | Ne pas changer flags prod en 5B ; rollback flags immédiat si tests staging KO |
| Scope creep vers 5C (creates) | Refuser dans 5B ; lister en backlog 5C |
| Tentation de supprimer legacy « mort » | Interdit jusqu’à Phase 6 |
| Complexité adapters | Un service à la fois ; completion partielle possible si Food OK puis suite |

---

## 8. Critères de sortie Phase 5B (Definition of Done)

La phase 5B est **COMPLÉTÉE** seulement si **tous** les points suivants sont vrais :

1. Pour Food, Package, Taxi, Marketplace : le chemin `engine` produit les montants **sans** utiliser le helper legacy comme source de vérité de calcul.  
2. Preuve code-reviewable : inventaire des appels — legacy uniquement pour shadow/fallback, pas pour SoT engine.  
3. Tests automatisés verts sur adapters + charge path engine (environnement de test).  
4. Kill Switch, Shadow, Feature Flags, fail-open **toujours présents**.  
5. Aucune suppression de code legacy.  
6. Document `PHASE-5B-COMPLETION.md` livré.  
7. **Validation humaine** `Phase 5B — VALIDÉ` (ou équivalent).

**Non-exigé pour clôturer 5B :**

- Charge engine à 100 % en production  
- Couverture de tous les creates / quotes  
- Hard Gate GO  
- Cleanup Phase 6  

---

## 9. Critères de validation humaine (examen de ce START-GATE)

Avant d’autoriser l’implémentation, le fondateur valide que :

- [ ] L’objectif « Engine = seule SoT de **calcul** » est correctement cadré  
- [ ] Le legacy peut rester physiquement présent — acceptable  
- [ ] 5C / 5D / 5E / 6 restent hors scope  
- [ ] Aucune suppression flags / Kill / Shadow / legacy n’est demandée en 5B  
- [ ] L’ordre Food → Package → Taxi → Marketplace est acceptable (ou à amender)  
- [ ] Les flags prod ne seront **pas** modifiés pendant 5B  

---

## 10. Plan d’implémentation (activable seulement après approbation)

| Étape | Contenu | Gate |
|---|---|---|
| 0 | Ce document | START-GATE |
| 1 | Approbation humaine | `Phase 5B — APPROUVÉ` |
| 2 | Implémentation Food independence | — |
| 3 | Implémentation Package independence | — |
| 4 | Implémentation Taxi independence | — |
| 5 | Implémentation Marketplace independence | — |
| 6 | Tests + preuves d’indépendance | — |
| 7 | `PHASE-5B-COMPLETION.md` | COMPLETION |
| 8 | Revue humaine | `Phase 5B — VALIDÉ` |
| 9 | Préparation START-GATE **5C** | Suite |

---

## 11. Rollback (pendant/après implémentation 5B)

| Situation | Action |
|---|---|
| Bug sur chemin engine | Flags charge restent `0` (défaut) → trafic legacy |
| Régression détectée en staging avec flag engine | Revenir flag `0` ; corriger adapter |
| Besoin d’urgence prod | Kill Switch / fail-open (déjà en place) — **ne pas** supprimer |

Aucune action de rollback ne nécessite de supprimer du code.

---

## 12. Décision demandée

| Option | Signification |
|---|---|
| **`Phase 5B — APPROUVÉ`** | Autorise l’implémentation selon ce START-GATE |
| **`Phase 5B — APPROUVÉ AVEC AMENDEMENTS`** | Lister les amendements ; puis implémentation |
| **`Phase 5B — REPORTÉ`** | Pas d’implémentation ; préciser motif |

---

## 13. Engagement agent (état actuel)

À ce stade (**START-GATE uniquement**) :

- ✅ Feuille de route closure enregistrée **APPROUVÉE**  
- ✅ Ce START-GATE 5B rédigé  
- ❌ **Aucune** modification de code Pricing Engine  
- ❌ **Aucune** suppression legacy / flags / Kill / Shadow  
- ❌ **Aucune** implémentation 5B tant que `Phase 5B — APPROUVÉ` n’est pas reçu  

---

*Document de gouvernance — Phase 5B Independence — START-GATE — 2026-08-03.*
