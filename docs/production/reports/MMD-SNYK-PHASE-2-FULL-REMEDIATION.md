# MMD — Phase 2 : remédiation Snyk open et Netty

> Document historique. Le résultat publié est dans `MMD-DELIVERY-FINAL-SECURITY-AND-INTEGRATION.md`.

Date : 2026-11-06.  
Branche : `fix/snyk-deepmerge-cve-2026-93753`.  
HEAD : `b07da172095a455dfd49c14975566d8992e8b87f`.  
`origin/main` : `b07da172095a455dfd49c14975566d8992e8b87f`.  
Aucun commit, aucune PR, aucun push, aucun merge, aucun déploiement Vercel, aucun build EAS.

**Verdict de cette phase : ORANGE. Intégration non réalisée.**

Les trois avis nommés au départ de cette phase ne sont plus ouverts sur les sept cibles produit. Les tests automatisés demandés qui ont été lancés sont passés. L’intégration est refusée parce que des preuves exigées manquent : Pixel 5, iOS, appareil physique, dashboard Snyk Cloud, et, au moment de cette phase, une compilation release Android terminée.

Mise à jour phase 3 : la compilation release du projet canonique `android/` a ensuite réussi. Le détail est dans `MMD-SNYK-PHASE-3-FINAL-VALIDATION.md`. Ce document reste le constat de la phase 2. Aucun commit n’a été créé.

## Situation initiale

Le contrôle précédent, consigné dans `MMD-SNYK-MEDIUM-REMEDIATION-VALIDATION.md`, était ROUGE.

Déjà en place et conservés :

- `vendor/deepmerge` `4.3.2`, correctif de prototype pollution, licence MIT.
- `vendor/inflight` `1.0.7`, libération du slot, licence ISC.
- Expo `~54.0.36`, React Native `0.81.5`.
- `.snyk` inchangé. L’ignore ne couvre que `SNYK-JS-INFLIGHT-6095116` pour `inflight@1.0.6`, absent du lock.

Avis encore ouverts avant cette phase :

| Identifiant | Paquet | Gravité | Parent constaté |
| --- | --- | --- | --- |
| `SNYK-JS-OPEN-22112123` | `open@7.4.2` | High | `@react-native/dev-middleware@0.81.5` |
| `SNYK-JAVA-IONETTY-17254120` | `io.netty:netty-handler@4.1.110.Final` | Critical | plugin Unified Test Platform |
| `SNYK-JAVA-IONETTY-19005879` | `io.netty:netty-handler@4.1.110.Final` | Critical | même artefact, avis distinct |

`open@8.4.2` arrivait aussi par `better-opn@3.0.2` / `@expo/cli@54.0.26`. Il est sous la version corrigée officielle `11.0.0` et porte le même défaut de guillemets PowerShell. Il a été traité avec le même correctif.

## open

Chaînes :

- Racine : `mmd-delivery > expo@54.0.36 > @expo/cli@54.0.26 > @react-native/dev-middleware@0.81.5 > open@7.4.2`.
- Mobile : `mmd-mobile > react-native@0.81.5 > @react-native/community-cli-plugin@0.81.5 > @react-native/dev-middleware@0.81.5 > open@7.4.2`.
- `@expo/cli@54.0.26 > better-opn@3.0.2 > open@8.4.2`.

`open` sert à ouvrir une URL dans le navigateur pendant le développement (lanceur Metro / React Native, et `better-opn`). Ce n’est pas une dépendance du bundle client.

`@react-native/dev-middleware@0.81.5` fait `require("open")` puis `await open(url)`. Sa contrainte est `open ^7.0.3`. `better-opn@3.0.2` appelle `open(url, { app: { name, arguments }, wait: false })` et dépend de `open ^8.0.4`. `open@11` est le correctif npm, mais il est ESM-only. Un `require` depuis le middleware 0.81.5 ne peut pas le charger. Monter Expo ou React Native n’était pas nécessaire et n’a pas été fait.

pnpm ne garde qu’une copie hissée de `open`. Les deux overrides pointent donc vers le même paquet :

- `open@7.4.2` → `file:vendor/open`
- `open@8.4.2` → `file:vendor/open`

`vendor/open` est le source CommonJS d’`open@8.4.2`, étiqueté localement `8.4.3`. Ce n’est pas une publication npm et ce n’est pas `open@11`. L’API objet `app` de la version 8 est conservée, donc `await open(url)` et l’appel `better-opn` fonctionnent. Sous Windows, le nom d’application, la cible et chaque argument sont entourés de quotes simples PowerShell avant l’encodage UTF-16LE. Un `$`, un `$(...)` ou un guillemet double dans l’URL ne sort plus de la chaîne.

Licence : MIT. Notice : Copyright (c) Sindre Sorhus, fichier `vendor/open/license`.

Le lock résout `open@file:vendor/open`. Il n’y a plus de bloc `resolution` pour `open@7.4.2` ni `open@8.4.2`. Les scans pnpm racine, mobile et web après ce correctif sont à 0 avis. Le test `scripts/open-cve-2026-119025.regression.test.mjs` vérifie les overrides, l’absence des résolutions vulnérables, la licence, l’égalité des octets avec les deux appelants, et trois commandes PowerShell décodées, dont un payload `$(whoami)` et l’objet `app`.

## Netty — deux avis, même artefact

Parent : configuration Gradle `_internal-unified-test-platform-android-test-plugin-result-listener-gradle`, dépendance `com.android.tools.utp:android-test-plugin-result-listener-gradle:31.11.0`, puis `io.grpc:grpc-netty` `1.69.1` et `1.57.2`, qui demandaient `netty-handler` `4.1.110.Final` et `4.1.93.Final`.

Classpaths mesurés sur `apps/mobile/android` avant le forçage, avec Gradle 8.14.3 :

- `:app:debugRuntimeClasspath` : pas de Netty.
- `:app:releaseRuntimeClasspath` : pas de Netty.
- `:app:debugCompileClasspath` : pas de Netty.
- `:app:debugAndroidTestRuntimeClasspath` : pas de Netty.
- configuration Unified Test Platform : Netty présent.

`releaseRuntimeClasspath` contenait en revanche `guava:31.0.1-android` (ExoPlayer) et `commons-io:2.6`. `protobuf-java` n’y était pas. Aucun APK ni AAB n’a été assemblé. L’absence sur ces classpaths est la preuve disponible que Netty n’entre pas dans l’application livrée par ces configurations. Ce n’est pas une preuve par simple lecture du nom du plugin.

Les deux identifiants sont distincts. `SNYK-JAVA-IONETTY-17254120` est corrigé en amont à partir de `4.1.135.Final`. `SNYK-JAVA-IONETTY-19005879` est corrigé à partir de `4.1.137.Final`. La version retenue sur la seule configuration dont le nom contient `unified-test-platform` est `4.1.138.Final`, qui couvre les deux. Le passage à la ligne `4.2` n’a pas été fait : gRPC `1.57.2` et `1.69.1` restent sur Netty `4.1`. Le plugin de test n’a pas été retiré. Aucun test n’a été désactivé.

Gradle a montré `io.netty:netty-handler:4.1.138.Final` sur cette configuration. Les deux rescans `app/build.gradle` ci-dessous ne contiennent plus aucun Critical. Les deux identifiants sont absents de ces résultats.

## Autres avis du module app, corrigés dans le même bloc

Après Netty `4.1.138`, le module app portait encore 2 High et 2 Medium. Ils ont été traités, puis rescannés :

- `SNYK-JAVA-COMGOOGLEGUAVA-20825054` : `guava` forcé en `33.7.2-android` sur toutes les configurations, parce que `31.0.1-android` est sur le classpath release. Gradle a résolu `31.0.1-android -> 33.7.2-android` (demandé par `exoplayer-common:2.18.1`).
- `SNYK-JAVA-COMMONSIO-1277109` et `SNYK-JAVA-COMMONSIO-8161190` : `commons-io` forcé en `2.18.0` sur toutes les configurations, parce que `2.6` est sur le classpath release.
- `SNYK-JAVA-COMGOOGLEPROTOBUF-8055227` : `protobuf-java` forcé en `3.25.5` seulement sur la configuration Unified Test Platform. Il n’est pas ajouté au classpath release.

Le bloc est dans `android/app/build.gradle`, fichier suivi. La même copie a été appliquée à `apps/mobile/android/app/build.gradle`. Ce second fichier est ignoré par Git (`apps/mobile/android/`). Le correctif qui peut être intégré plus tard est celui de `android/app/build.gradle`.

`:app:compileReleaseKotlin` a échoué en 29 secondes avant une compilation Kotlin utile de l’application. Guava était déjà résolu en `33.7.2-android`. L’échec vient de `:sentry_react-native:generateCodegenSchemaFromJavaScript` (`glob` `sync.js`, `rawGlob` indéfini) et de `:app:createBundleReleaseJsAndAssets`. `NODE_ENV` n’était pas défini. Ce n’est pas une erreur de compilation attribuée à l’API Guava. La compatibilité binaire de Guava 33 avec ExoPlayer n’est donc pas démontrée par un build vert. Aucun second build release n’a été relancé.

## deepmerge et inflight

Les overrides `file:vendor/deepmerge` et `file:vendor/inflight` sont inchangés. Les tests `scripts/deepmerge-cve-2026-93753.regression.test.mjs` et `scripts/inflight-memory-release.regression.test.mjs` passent dans `pnpm test:ci`.

deepmerge : `propertyIsForbidden` écarte `__proto__`, `constructor` et `prototype`. Consommateurs : `@expo/config` `12.0.13` et `12.0.14` seulement. Licence MIT, notice James Halliday, Josh Duff and other contributors, `vendor/deepmerge/license.txt`. Aucune résolution `deepmerge@4.3.1` vulnérable. `SNYK-JS-DEEPMERGE-19964053` absent des scans pnpm.

inflight : première requête renvoie une fonction, les suivantes sur la même clé renvoient `null` et rejoignent les callbacks. `once` enveloppe le résultat. Les callbacks ajoutés en cours d’appel partent au tick suivant. Le `finally` retire le slot même si un callback jette. `FinalizationRegistry` libère `reqs[key]` quand la fonction retournée est abandonnée. `glob@7.2.3` est conservé. Licence ISC, notice Isaac Z. Schlueter, `vendor/inflight/LICENSE`. Aucune résolution `inflight@1.0.6`. `SNYK-JS-INFLIGHT-6095116` absent. L’ignore `.snyk` n’a pas été étendu.

## Marchés, paiements, langues

Aucun fichier Stripe, Orange Money, cash Guinée, marché, Supabase ou secret n’a été modifié pour cette phase. Les fichiers GPS et i18n déjà modifiés avant la phase ont été laissés tels quels. Les six catalogues `en`, `fr`, `es`, `ar`, `zh`, `ff` sont intacts dans le sens où aucune clé n’a été retirée ni remplacée par un texte temporaire pendant cette phase. `test:i18n-locale` couvre la cohérence des locales, le RTL limité à l’arabe, le marché guinéen, le checkout client, `fullScreenI18n` et les chauffeurs à proximité.

## Tests exécutés

| Commande | Résultat |
| --- | --- |
| `pnpm test:ci` | code 0, fin `2026-11-06T04:52:16Z`, environ 281 s. Inclut deepmerge, inflight, open, politique `.snyk`, secret-scan (5246 fichiers, 0 finding), suite web (Stripe, Guinée, taxi, finance, marketplace) et `test:navigation`. |
| `tsc --noEmit` racine, `apps/mobile`, `apps/web` | `TSC_OK` |
| `pnpm --dir apps/mobile test:i18n-locale` | code 0, fin `2026-11-06T04:54:52Z`. `fullScreenI18n` : `ok`, 103 routes, 102 écrans, 3728 clés. |
| `npx snyk test --all-projects` après le correctif `open`, avant les pins Guava | pnpm racine 748, mobile 751, web 474 : 0 avis. Les deux `build.gradle` projet : 0. Les deux `app` : encore 2 High, 2 Medium, 3 Low. |
| `npx snyk test --file=app/build.gradle` dans `apps/mobile/android` | 314 dépendances, 0 Critical, 0 High, 0 Medium, 2 Low. Code de sortie 1 à cause des Low. |
| `npx snyk test --file=app/build.gradle` dans `android` | 295 dépendances, 0 Critical, 0 High, 0 Medium, 2 Low. Code de sortie 1 à cause des Low. |
| Insight Gradle release / debug / test | Netty absent de ces classpaths. Présent seulement sur Unified Test Platform, en `4.1.138.Final` après forçage. |

Aucun test n’a été désactivé. Aucun ignore Snyk n’a été ajouté. Aucun projet Snyk n’a été supprimé.

## Résultats Snyk par cible produit

CLI `snyk@1.1308.4`, organisation `diallomamadoumaladho62102-beep`. Les chiffres app sont ceux des rescans ciblés après les pins. Les chiffres pnpm sont ceux du scan complet lancé après `vendor/open` et avant les pins Gradle. Les pins Gradle ne changent pas les arbres pnpm.

| Cible | Dépendances | Critical | High | Medium | Low |
| --- | ---: | ---: | ---: | ---: | ---: |
| Racine pnpm | 748 | 0 | 0 | 0 | 0 |
| Mobile pnpm | 751 | 0 | 0 | 0 | 0 |
| Web pnpm | 474 | 0 | 0 | 0 | 0 |
| `android/build.gradle` | — | 0 | 0 | 0 | 0 |
| `apps/mobile/android/build.gradle` | — | 0 | 0 | 0 | 0 |
| `android/app/build.gradle` | 295 | 0 | 0 | 0 | 2 |
| `apps/mobile/android/app/build.gradle` | 314 | 0 | 0 | 0 | 2 |

Total sur ces sept cibles : **0 Critical, 0 High, 0 Medium, 2 Low** (les deux Low sont les mêmes avis sur les deux modules app, pas quatre avis différents).

Low restants, non masqués :

- `SNYK-JAVA-COMMONSCODEC-561518`, `commons-codec@1.10`. Snyk indique un correctif en `1.14`. Chemin mobile : `expo.modules.filesystem@19.0.23`. Chemin racine : dépendance directe du module app. Non forcé dans cette phase.
- `SNYK-JAVA-ORGJETBRAINSKOTLIN-2393744`, `kotlin-stdlib@1.8.21`, corrigé en amont en `2.1.0`. Introduit par `com.google.testing.platform` `0.0.9-alpha03`. Le plugin Kotlin du projet est déjà en `2.1.20`. La stdlib `1.8.21` du plugin de test n’a pas été forcée, pour ne pas substituer la stdlib de cette plateforme de test sans preuve de compatibilité.

`npx snyk test --all-projects` entre aussi dans des `build.gradle` sous `node_modules` (Expo, Stripe, Sentry, et d’autres). Ces fichiers ne sont pas les sept cibles. Ils ne lisent pas le `resolutionStrategy` de l’application. Le scan complet antérieur y voyait encore des Critical, dont Netty et BouncyCastle. Ils n’ont pas été modifiés. Un `all-projects` complet après les pins app n’a pas été relancé jusqu’au bout : le correctif app ne change pas ces fichiers tiers.

Le dashboard Snyk Cloud des projets GitHub suit `main`. Cet arbre n’est ni commité ni poussé. Le Cloud n’a pas été actualisé. Le jeton CLI n’a pas été lu.

## Pixel 5, iOS, appareil physique

`adb devices` n’a listé aucun appareil. `emulator-5554` n’était pas disponible. Aucun émulateur n’a été démarré ni réinitialisé. Le parcours MMD Delivery sur Pixel 5 n’a pas été exécuté. Metro `8081` n’a pas servi un test visuel.

Aucun appareil iOS et aucun appareil physique n’étaient disponibles. Aucun de ces tests n’a été exécuté. Aucun build EAS n’a été lancé.

Validations restantes :

- démarrage, navigation, session de test existante, déconnexion, six langues, RTL arabe, parcours États-Unis et Guinée, sur Pixel 5 déjà allumé ;
- le même parcours sur un appareil physique ;
- un build iOS réel, hors EAS lancé depuis cette mission.

## Non-régression

Expo `54.0.36` et React Native `0.81.5` sont inchangés. Aucune règle de paiement, aucun marché, aucune donnée Supabase, aucun secret n’a été modifié. Les changements GPS et i18n déjà présents dans l’arbre de travail ont été conservés et ne font pas partie du correctif Snyk. Les inclure dans une PR de sécurité rendrait le diff plus large que les corrections validées. C’est une raison supplémentaire de ne pas fusionner cet arbre tel quel.

La compilation release locale n’a pas abouti. L’échec observé est le codegen Sentry et le bundle JS sans `NODE_ENV`, pas une erreur Guava. L’absence de régression native Guava 33 reste non prouvée.

## Fichiers de cette phase

Suivis et modifiés pour la remédiation :

- `package.json` : overrides `open@7.4.2` et `open@8.4.2` vers `file:vendor/open`, script de test branché dans `test:ci`.
- `pnpm-lock.yaml` : résolution `open@file:vendor/open`.
- `android/app/build.gradle` : `resolutionStrategy` Guava, commons-io, Netty, protobuf.
- `scripts/open-cve-2026-119025.regression.test.mjs` : nouveau.
- `vendor/open/` : nouveau. `vendor/open-8/` a été retiré après fusion des deux copies en une seule.

Déjà présents et conservés : `vendor/deepmerge/`, `vendor/inflight/`, leurs tests, les fichiers GPS et les catalogues i18n.

Ignoré par Git, patché localement pour le scan : `apps/mobile/android/app/build.gradle`.

Non créés : `MMD-SNYK-FINAL-INTEGRATION.md`. Il n’y a pas eu d’intégration.

## Intégration

Conditions non réunies :

1. Pixel 5 non exécuté.
2. iOS et appareil physique non exécutés.
3. Snyk Cloud non actualisé, et un verdict vert n’est pas autorisé sur les scans locaux seuls.
4. Compilation release Android non terminée, donc le saut Guava `31.0.1-android` → `33.7.2-android` sur le classpath livré n’est pas prouvé compatible.
5. L’arbre de travail contient des modifications GPS et i18n antérieures. Une PR de tout l’arbre ne correspondrait pas aux seules corrections de sécurité validées.
6. Deux Low restent ouverts. Ils ne sont pas un Critical, un High ou un Medium, mais ils sont documentés et non masqués.

Aucune PR. Aucun commit de fusion. `main` et `origin/main` restent `b07da172095a455dfd49c14975566d8992e8b87f`. Vercel n’a pas été déclenché par cette phase.

## Risques résiduels

- `commons-codec@1.10` et `kotlin-stdlib@1.8.21` restent des Low sur les deux modules app.
- Les `build.gradle` des modules npm ne sont pas couverts par le forçage de l’application.
- Guava `33.7.2-android` est résolu sur le classpath release sans compilation release verte.
- Le Cloud GitHub ne verra ces corrections qu’après un push sur la branche qu’il teste. Ce push n’a pas été fait.
- `apps/mobile/android/` est régénérable et ignoré. Un prebuild peut écraser la copie locale. Le fichier durable est `android/app/build.gradle`.
