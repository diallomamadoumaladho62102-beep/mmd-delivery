# MMD — Validation de la remédiation Snyk avant intégration

> Document historique. Le résultat publié est dans `MMD-DELIVERY-FINAL-SECURITY-AND-INTEGRATION.md`.

Date du contrôle : 2026-11-06.  
Branche : `fix/snyk-deepmerge-cve-2026-93753`.  
HEAD et `origin/main` : `b07da172095a455dfd49c14975566d8992e8b87f`.  
Les corrections restent dans l’arbre de travail. Aucun commit, push, merge ou déploiement n’a été fait.

**Verdict historique de ce contrôle : ROUGE.**  
**Verdict après la phase 2 (2026-11-06, même commit `b07da172`, travail toujours non commité) : ORANGE. Aucune intégration.**

Ce document conserve le contrôle qui a trouvé `open@7.4.2` (High) et les deux Critical Netty. Ces trois avis ne sont plus présents sur les sept cibles produit après la phase 2. Le détail, les versions et les scans de confirmation sont dans `MMD-SNYK-PHASE-2-FULL-REMEDIATION.md`.

Le verdict actuel n’est pas vert : l’émulateur Pixel 5 n’a pas été exécuté, aucun appareil iOS ou physique n’a été testé, le dashboard Snyk Cloud n’a pas été actualisé, et la compilation release Android n’est pas allée au bout. Il reste 2 Low sur chaque module `app`. Aucun commit, push, merge ou déploiement n’a été fait.

---

## A. Résumé exécutif

- `deepmerge@4.3.1` est remplacé par `vendor/deepmerge` (étiquette locale `4.3.2`). Les trois contournements de `CVE-2026-93753` sont refusés, ainsi que `constructor` et `prototype`.
- `inflight@1.0.6` est remplacé par `vendor/inflight` (étiquette locale `1.0.7`). L’API de `glob@7.2.3` est conservée. Un appel abandonné libère le slot après ramasse-miettes.
- Expo reste `~54.0.36`. React Native reste `0.81.5`. `glob@7.2.3` n’a pas été monté en version 10.
- `.snyk` n’a pas été modifié. L’ignore existant vise encore uniquement `inflight@1.0.6`, qui n’est plus dans le lock. Le scan CLI affiche `Ignored: 0`.
- Les 29 clés i18n et les 8 clés `gps.*` existent dans `en`, `fr`, `es`, `ar`, `zh` et `ff`, sans texte temporaire et sans copie anglaise involontaire.
- Scan CLI Snyk `1.1308.4`, org `diallomamadoumaladho62102-beep`, lancé `2026-11-06T04:09:17Z`, terminé `2026-11-06T04:20:47Z`, code de sortie `1` :
  - racine pnpm : 749 dépendances, **0 Critical, 1 High, 0 Medium, 0 Low** (`SNYK-JS-OPEN-22112123`, `open@7.4.2`) ;
  - mobile pnpm : 752 dépendances, **0 Critical, 1 High, 0 Medium, 0 Low** (même avis) ;
  - web pnpm : 474 dépendances, **0 / 0 / 0 / 0** ;
  - `android/build.gradle` et `apps/mobile/android/build.gradle` : **0** ;
  - `android/app/build.gradle` : 316 dépendances, **2 Critical, 26 High, 24 Medium, 3 Low** ;
  - `apps/mobile/android/app/build.gradle` : 335 dépendances, **2 Critical, 26 High, 24 Medium, 3 Low**.
- `SNYK-JS-DEEPMERGE-19964053` et `SNYK-JS-INFLIGHT-6095116` n’apparaissent pas.
- `adb devices` n’a listé aucun appareil. Metro `127.0.0.1:8081` ne répondait pas. Le parcours Pixel 5 n’a pas été exécuté.
- Aucune autorisation d’intégration n’est demandée ici. Elle reste en attente.

## B. Audit deepmerge

Licence : MIT, `vendor/deepmerge/license.txt`.  
Copyright : « Copyright (c) 2012 James Halliday, Josh Duff, and other contributors ».  
La notice de copyright et la permission sont dans la copie. Le `package.json` local déclare `license: MIT` et inclut `license.txt`.

Le correctif est dans `vendor/deepmerge/dist/cjs.js`, fonction `propertyIsForbidden`. Les clés `__proto__`, `constructor` et `prototype` sont ignorées avant toute écriture sur l’objet retourné. `deepmerge.all`, les tableaux, les symboles et les champs de config Expo continuent de fusionner.

Consommateurs réels, une seule version installée (`pnpm why deepmerge`) :

- `@expo/config@12.0.13` et `@expo/config@12.0.14` ;
- parents Expo : `@expo/cli`, `@expo/metro-config`, `@expo/prebuild-config`, `expo-constants`, `expo-manifests`.

Le test charge les deux copies d’`@expo/config` et compare les octets à `vendor/deepmerge/dist/cjs.js`. Aucun `package.json` installé nommé `deepmerge` n’est encore en `4.3.1`. Le lock ne contient que `deepmerge@file:vendor/deepmerge`. Les deux snapshots `@expo/config` pointent vers ce répertoire.

Tests ajoutés et réussis le 2026-11-06 : `deepmerge.all` avec symbole conservé, clés interdites retirées, parcours des copies installées.

## C. Audit inflight

Licence : ISC, `vendor/inflight/LICENSE`.  
Copyright : « Copyright (c) Isaac Z. Schlueter ».  
La notice est présente dans la copie. Dépendances inchangées : `once` et `wrappy`.

Comportement vérifié par `scripts/inflight-memory-release.regression.test.mjs` :

- premier appel : fonction ; appels suivants sur la même clé : `null` ;
- trois callbacks reçoivent la même erreur et la même valeur ;
- un callback qui lance une exception libère quand même la clé ;
- un callback qui rejoint la même clé pendant l’exécution est appelé au tick suivant, comme `glob@7` ;
- une fonction abandonnée disparaît après `global.gc()` et `setImmediate`, puis la clé peut être réutilisée ;
- `glob.sync("package.json")` depuis le `glob@7` de React Native inclut `package.json`.

Résolution réelle, une seule version (`pnpm why inflight`) :

- `glob@7.2.3` ;
- `@react-native/codegen@0.81.5` et `react-native@0.81.5` ;
- `rimraf@3.0.2` via `@react-native/dev-middleware@0.81.5` ;
- `test-exclude@6.0.0` via `babel-plugin-istanbul` et Jest.

Ces quatre points d’entrée résolvent le fichier `vendor/inflight/inflight.js`. `glob@7.2.3` est toujours dans le lock. `inflight@1.0.6` n’y est plus. `glob` et React Native n’ont pas été modifiés pour faire disparaître l’alerte.

Le dossier `vendor/inflight` n’a pas de `node_modules` local. Snyk le signale (« Missing node_modules folder »). `once` et `wrappy` sont hissés par pnpm. Ce message ne signifie pas que le tarball npm `1.0.6` est encore installé.

## D. Licences et conformité

| Copie | Licence | Notice conservée | Version locale | Version npm vulnérable |
| --- | --- | --- | --- | --- |
| `vendor/deepmerge` | MIT | Oui, `license.txt` | `4.3.2` (non publiée) | `4.3.1` |
| `vendor/inflight` | ISC | Oui, `LICENSE` | `1.0.7` (non publiée) | `1.0.6` |

Les deux licences autorisent la copie et la modification à condition de garder la notice. Cette condition est remplie. Ce ne sont pas des publications npm. Aucun autre paquet n’a été ajouté au manifeste pour cette remédiation.

## E. Concurrence et mémoire

Exécuté : `node scripts/inflight-memory-release.regression.test.mjs` (relancé avec `--expose-gc`).  
Résultat : toutes les assertions `ok`, dernière ligne `inflight-memory-release.regression.test.mjs OK`.

Couvert : trois appels simultanés, exception, callback ajouté pendant l’exécution, abandon puis libération, réutilisation de la clé, `glob.sync`.  
Non couvert par un test dédié : une fuite mesurée en octets sur un long run Metro. La preuve est le retrait du slot dans `reqs`, pas un profil mémoire d’appareil.

## F. Arbre de dépendances

Overrides racine réellement appliqués :

- `deepmerge`: `file:vendor/deepmerge`
- `inflight`: `file:vendor/inflight`

Installé : deepmerge `4.3.2`, inflight `1.0.7`.  
`pnpm why` : une version de chaque.  
Expo : `~54.0.36`. React Native : `0.81.5`.  
Le diff de `pnpm-lock.yaml` contre `origin/main` ne change que ces deux résolutions, les deux snapshots `@expo/config`, et le snapshot `glob@7.2.3`. Aucun autre paquet n’est monté ou descendu.  
`apps/mobile/package.json` et `apps/web/package.json` sont inchangés. Le bloc `overrides` obsolète de l’application mobile n’a pas été touché.  
`.snyk` : diff vide. Le test `scripts/snyk-inflight-policy.regression.test.mjs` confirme un seul ignore, `SNYK-JS-INFLIGHT-6095116` / `inflight@1.0.6`, expiration `2027-09-02`, aucun patch. Cet ignore ne correspond plus au paquet résolu.

## G. Cinq scans Snyk locaux

CLI : `npx snyk test --all-projects`, binaire `snyk@1.1308.4`.  
Environnement du processus : `JAVA_HOME` = JBR Android Studio, `ANDROID_HOME` = SDK local. `local.properties` n’a pas été écrit.  
Ce sont des résultats CLI. Ils ne mettent pas à jour le dashboard GitHub.

| Projet demandé | Cible | Dépendances | Critical | High | Medium | Low |
| --- | --- | --- | --- | --- | --- | --- |
| Root pnpm | `package.json` | 749 | 0 | 1 | 0 | 0 |
| Mobile pnpm | `apps/mobile/package.json` | 752 | 0 | 1 | 0 | 0 |
| Web pnpm | `apps/web/package.json` | 474 | 0 | 0 | 0 | 0 |
| Android build | `android/build.gradle` | — | 0 | 0 | 0 | 0 |
| Android build mobile | `apps/mobile/android/build.gradle` | — | 0 | 0 | 0 | 0 |
| Android app | `android/app/build.gradle` | 316 | 2 | 26 | 24 | 3 |
| Android app mobile | `apps/mobile/android/app/build.gradle` | 335 | 2 | 26 | 24 | 3 |

High pnpm : `SNYK-JS-OPEN-22112123`, `open@7.4.2`, « Improper Encoding or Escaping of Output ».  
Chemin racine : `expo@54.0.36` → `@expo/cli@54.0.26` → `@react-native/dev-middleware@0.81.5` → `open@7.4.2` (51 chemins).  
Chemin mobile : `react-native@0.81.5` → `@react-native/community-cli-plugin@0.81.5` → le même `open@7.4.2` (39 chemins).  
`Ignored: 0` sur ces deux projets. Ce High n’est pas masqué. Il n’est pas introduit par le diff de cette branche : le diff ne touche pas `open`. Il n’était pas dans le scan local précédent, qui annonçait 0. Il est présent dans ce scan.

Critical du module app : `io.netty:netty-handler@4.1.110.Final`.

- `SNYK-JAVA-IONETTY-17254120` — Incorrect Comparison — correctif annoncé en `4.1.135.Final` / `4.2.15.Final`.
- `SNYK-JAVA-IONETTY-19005879` — Improper Check for Unusual or Exceptional Conditions — correctif annoncé en `4.1.137.Final` / `4.2.17.Final`.

Introduction : `com.android.tools.utp:android-test-plugin-result-listener-gradle@31.11.0` → `io.grpc:grpc-netty@1.69.1`. C’est le classpath de test Android, pas une dépendance ajoutée par cette branche. Les fichiers Gradle du dépôt ne sont pas dans le diff.

Le même `all-projects` a aussi commencé à tester des `build.gradle` sous `node_modules` (expo, expo-updates, stripe-react-native, etc.). Exemple déjà imprimé : `node_modules/expo/android/build.gradle`, 82 issues (5 Critical, 39 High, 34 Medium, 4 Low), dont BouncyCastle via Robolectric. Le processus s’est arrêté avec le code `1` pendant `node_modules/expo-constants/android/build.gradle`. Ces fichiers ne sont pas les cinq projets produit. Leurs totaux incomplets ne sont pas additionnés ici. Aucun ignore n’a été ajouté pour les faire disparaître.

Les deux avis deepmerge et inflight sont absents de cette sortie.

## H. Dashboard Snyk Cloud

Le dashboard officiel GitHub n’a pas été actualisé.

La branche pointe sur le même commit que `origin/main`. Les correctifs ne sont pas commités et n’ont pas été poussés. Snyk Cloud, pour les projets importés depuis GitHub, teste l’arbre distant. Il ne peut pas voir cet arbre de travail. Aucun push n’a été fait pour provoquer un retest. Aucun `snyk monitor` n’a été lancé.

## I. i18n, six langues

`pnpm test:i18n-locale` dans `apps/mobile`, code `0`, durée environ 44 s, fin `2026-11-06T04:10:02Z` :

- `localeConsistency.regression.test.ts OK`
- `languageSwitch.regression.test.ts — PASS` (cycle FR EN ES AR ZH FF, RTL seulement pour l’arabe)
- `guineaMarket.i18n.test.ts OK`
- `clientCheckoutI18n.regression.test.ts OK`
- `fullScreenI18n` : `{"ok":true,"routes":103,"screens":102,"usedKeys":3728}`
- `nearbyDrivers.regression.test.ts OK`

Contrôle direct des 29 clés ajoutées (`deliveryRequest.alerts.createdCashBody`, `driver.cash.*`, `common.profile.docEmpty/docTooLarge/docBadType`, `driver.profile.doc*`, `restaurant.orders` et `seller.orders` cash, `seller.products.pendingReview*`, `locationPicker.missingPinBody/retryGps/awaitingGps`) : présentes dans les six langues, aucune égale à l’anglais lorsqu’elle contient un mot latin, aucun `TODO` / `TBD` / `FIXME` / `lorem`.  
Les 8 clés `gps.*` de `common.json` passent le même contrôle.  
Aucun test i18n n’a été désactivé. Le RTL arabe est prouvé par le test de bascule de langue, pas par un écran sur appareil.

## J. Pixel 5

Non exécuté.

`adb devices -l` : démon démarré, aucun appareil, pas de `emulator-5554`.  
`http://127.0.0.1:8081/status` : connexion refusée. Metro n’était pas déjà lancé.  
Aucun émulateur n’a été créé, réinitialisé ou démarré. Aucun compte, commande, transaction, mission ou donnée de production n’a été créé.  
Donc : pas de preuve de démarrage applicatif, de navigation, de connexion, de déconnexion, de chargement d’écran, de rendu des six langues, ni de RTL visuel.

## K. Diff et risques de régression

`git diff --name-only origin/main` ne contient que :

- écrans et lib GPS qui remplacent les phrases françaises de repli par les constantes anglaises `GPS_DEFAULTS` ;
- `common.json` et `extras.json` des six langues ;
- `package.json` : deux scripts de régression dans `test:ci`, deux overrides `file:` ;
- `pnpm-lock.yaml` : uniquement deepmerge et inflight ;
- `scripts/image-size-clean-install.regression.test.mjs` : l’assertion inflight attend maintenant la copie locale.

Fichiers non suivis : `vendor/deepmerge/`, `vendor/inflight/`, les deux scripts de régression.  
Hors diff : Stripe, Orange Money, Supabase, `.snyk`, secrets d’environnement, configuration de production, marchés US / GN / SN / CI.  
`node scripts/secret-scan.mjs` : `{"ok":true,"files_scanned":5240,"findings":0}`.  
Le fonctionnement Stripe US et Orange Money n’a pas été modifié dans le code. Il n’a pas non plus été rejoué sur un appareil.

Risque restant côté correctif : la copie deepmerge est un peu plus stricte que le comportement npm (elle refuse aussi `constructor` et `prototype`). Les objets de config Expo testés n’utilisent pas ces clés. Un plugin qui enverrait volontairement une clé `constructor` la perdrait.

## L. Problèmes restants

1. High CLI `open@7.4.2` sur la racine et le mobile. Non corrigé, non ignoré. Hors du diff de cette branche.
2. Module Android `app` : 2 Critical Netty et 24 Medium / 26 High / 3 Low, via le plugin de test Android. Non corrigé. Les `build.gradle` de projet restent à 0.
3. Le parcours `all-projects` n’a pas fini tous les `build.gradle` de `node_modules`.
4. Dashboard Snyk GitHub non retesté.
5. Pixel 5, appareil physique et iOS non exécutés.
6. npm ne publie toujours pas de correctif officiel pour deepmerge ni inflight. Les copies locales sont le correctif.
7. L’ignore historique `inflight@1.0.6` est encore dans `.snyk`. Il ne s’applique plus au graphe résolu. Il n’a pas été élargi.

## M. Verdict final

**ROUGE.**

Les validations deepmerge, inflight, licences, lock, Expo 54.0.36, React Native 0.81.5, i18n et absence de secrets sont réussies. L’intégration n’est pas autorisée par ce rapport : un High pnpm et deux Critical Gradle app sont ouverts, le Pixel 5 n’a pas tourné, et le dashboard Cloud ne connaît pas cet arbre.

Aucune intégration ne sera faite sans une autorisation explicite.
