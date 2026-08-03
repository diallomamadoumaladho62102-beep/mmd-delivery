# Refonte Premium — Écran Restaurant & Ticket Imprimable

**Date :** 2026-08-03  
**Référence visuelle :** `docs/branding/restaurant-order/mockup-apres.png`  
**Statut :** implémenté (pas encore commité — validation fondateur recommandée)

## Objectif

Le restaurant ne voit que ce qui sert à **préparer** et à **remettre** la commande au bon livreur via le **code Pickup**.

## Captures / aperçus

| Artefact | Chemin |
|---------|--------|
| Maquette validée (APRÈS) | `docs/branding/restaurant-order/mockup-apres.png` |
| Ticket thermique 58 mm | `docs/branding/restaurant-order/ticket-preview-58mm.html` |
| Ticket thermique 80 mm | `docs/branding/restaurant-order/ticket-preview-80mm.html` |

Ouvrir les HTML dans un navigateur pour l’aperçu impression / PDF.

### Avant → Après (écran)

| Avant | Après |
|------|-------|
| Totaux, taxes, commission, net restaurant | Supprimés |
| Photo / nom / appel / chat chauffeur | Supprimés |
| Call / Message MMD Support | Supprimés de l’écran principal |
| Avatar client + call/message | Identifiant / prénom + adresse + instructions |
| Code pickup en petit champ texte | Carte blanche géante, contraste max |
| Prix par ligne | Quantités + variantes uniquement |
| Boutons multiples | Workflow préparation + **Imprimer** / **Réimprimer** |

### Ticket imprimable

| Avant | Après |
|------|-------|
| Total monétaire affiché | Aucun montant |
| Code pickup absent du HTML | Bloc encadré principal |
| Liste items avec `line_total` | Quantités + options + notes cuisine |
| Format générique | Optimisé **58 mm** et **80 mm** |

## Fichiers modifiés

### Mobile (React Native)

- `apps/mobile/src/screens/RestaurantOrderDetailsScreen.tsx` — UI premium least-privilege
- `apps/mobile/src/lib/restaurantPrintService.ts` — HTML ticket cuisine thermique

### Web

- `apps/web/app/orders/[orderId]/restaurant/page.tsx` — page restaurant dédiée
- `apps/web/app/orders/[orderId]/page.tsx` — cohérence rôle restaurant (pas de chauffeur / finance / live map)
- `apps/web/src/lib/restaurantPrintJobs.ts` — payload impression enrichi (ops) sans montants affichés

### Docs

- `docs/branding/restaurant-order/*`

## Composants / symboles React

- `RestaurantOrderDetailsScreen` (mobile)
- `RestaurantOrderPage` (web)
- Shared order page restaurant branches
- `buildRestaurantTicketHtml` / `printRestaurantTicket*`
- `buildPrintPayloadForOrder` / `queueRestaurantPrintJobsForOrder`

## Confirmations

| Critère | Statut |
|--------|--------|
| Aucune donnée financière visible restaurant | Oui |
| Aucun nom / photo chauffeur | Oui |
| Aucun support sur l’écran principal | Oui |
| Aucune info Stripe affichée | Oui |
| Code Pickup = élément principal écran + ticket | Oui |
| Ticket limité à la préparation cuisine | Oui |
| Aucune logique métier / paiement / commission modifiée | Oui — seuls l’UI et le contenu affiché/imprimé |
| Status accept / prepare / ready / cancel préservés | Oui |
| Print API inchangée (`requestOrderPrint`) | Oui |
| Cohérence least-privilege Client / Driver / Admin | Oui — finance/driver live restent côté client/admin ; driver voit toujours ce dont il a besoin ailleurs |

## Responsive

- Mobile app : layout scroll + cartes premium
- Web restaurant : max-width ~3xl, grille boutons `sm:`
- Impression : `@page` 58 mm / 80 mm, typo condensée

## Suite Git

Non commité volontairement — attendre validation visuelle fondateur, puis commit + push + merge `main`.
