# MMD — Phase 3 : compilation release, séparation, préparation d’intégration

> Document historique. Le résultat publié est dans `MMD-DELIVERY-FINAL-SECURITY-AND-INTEGRATION.md`.

Date : 2026-11-06.  
Branche : `fix/snyk-deepmerge-cve-2026-93753`.  
HEAD et `origin/main` : `b07da172095a455dfd49c14975566d8992e8b87f`.  
Aucun commit, aucune PR, aucun push, aucun merge, aucun déploiement, aucun EAS, aucun BUILD ALL.

**Verdict : ORANGE. Intégration non faite. Autorisation encore requise.**

Les tests techniques lancés passent. La compilation release Kotlin du projet Android suivi par Git réussit. Il reste un Low sur les modules `app`, aucune épreuve Pixel 5, iOS ou appareil physique, aucun dashboard Snyk Cloud actualisé, et aucun APK inspecté. Un verdict vert n’est pas donné sur les scans locaux seuls.

## Causes des erreurs release

Le premier échec, lancé depuis `apps/mobile/android`, combinait deux causes distinctes.

### Codegen Sentry : `rawGlob` indéfini

La tâche `:sentry_react-native:generateCodegenSchemaFromJavaScript` appelle `@react-native/codegen@0.81.5`. Ce paquet lance `glob@7.2.3` sur `**/*{,.fb}.{js,ts,tsx}`. `glob@7` lit le champ interne `pattern._glob` de minimatch 3. L’override `minimatch: ">=3.1.3"` résout minimatch `11.0.4` pour ce glob. Le champ n’existe plus, donc `rawGlob` est indéfini et `charAt` jette.

Ce n’est pas un défaut du SDK Sentry, ni de Metro, ni d’une incompatibilité Expo / React Native introduite par `open` ou Netty. C’est l’override de sécurité minimatch, déjà présent pour sortir des advisories minimatch, appliqué à un glob 7 qui ne connaît que l’API minimatch 3. Revenir à minimatch 3 rouvrirait la ligne que l’override ferme. Le correctif garde minimatch 11 et remplace cet appel par une lecture de répertoire des mêmes extensions : `.js`, `.ts`, `.tsx`, `.fb.js`, `.fb.ts`, `.fb.tsx`.

Correctif durable : `patches/@react-native__codegen@0.81.5.patch`, enregistré dans `pnpm.patchedDependencies`. Sentry, le codegen et le bundle JS restent actifs. Le CLI codegen sur le dossier Sentry a produit 3 modules. Le test `scripts/codegen-minimatch-11.regression.test.mjs` passe, y compris dans `pnpm test:ci`.

### `NODE_ENV` absent

`@expo/env` écrit un avertissement si `NODE_ENV` n’est pas défini, puis ne charge que `.env.local` et `.env`. Ce n’était pas l’exception fatale. `export:embed` appelle `setNodeEnv('production')` avant de charger les env du bundle quand `--dev false`.

La compilation canonique a été lancée avec `NODE_ENV=production`. Le bundle release a été produit. L’avertissement n’a pas arrêté cette compilation.

### Échec suivant : envoi des source maps Sentry

Une fois le codegen et le bundle passés sur `android/`, la tâche `createBundleReleaseJsAndAssets_SentryUpload_...` a échoué : `sentry-cli` demande un jeton d’authentification. `sentry.gradle` reste appliqué. Le SDK n’a pas été retiré. Le second lancement a utilisé la bascule officielle du plugin, `SENTRY_DISABLE_AUTO_UPLOAD=true`, uniquement pour ce processus local. L’upload a été marqué SKIPPED. Aucun jeton n’a été lu ni écrit.

## Résultat de compilation

Projet : `C:\DEV\MMD-Delivery\android` (suivi par Git).  
Commande : `:app:compileReleaseKotlin --no-daemon`.  
Environnement : `JAVA_HOME` = JBR Android Studio, `ANDROID_HOME` = SDK local, `NODE_ENV=production`, `SENTRY_DISABLE_AUTO_UPLOAD=true`.

`BUILD SUCCESSFUL in 2m 18s`. La tâche `:app:compileReleaseKotlin` a été exécutée. Le bundle JS release avait déjà été produit par le lancement précédent, qui s’était arrêté seulement sur l’upload Sentry.

Aucun APK et aucun AAB n’ont été assemblés. Le contenu empaqueté n’a donc pas été ouvert.

## Audit Guava

Parent : `com.google.android.exoplayer:exoplayer-common:2.18.1`, qui demande `guava:31.0.1-android`. Aussi demandé par `exoplayer-decoder`, `exoplayer-extractor`, `exoplayer-core` et `exoplayer`.

Version résolue sur `:app:releaseRuntimeClasspath` et `:app:releaseCompileClasspath` : `com.google.guava:guava:33.7.2-android`.

Absent de `:app:debugAndroidTestRuntimeClasspath`.

`33.7.2-android` est le plancher du correctif `CVE-2026-102554` / `SNYK-JAVA-COMGOOGLEGUAVA-20825054`. Il n’existe pas de correctif plus ancien compatible avec cet avis.

La compilation Kotlin de l’application a réussi avec cette version sur le classpath de compilation. ExoPlayer est livré en AAR déjà compilé : cette compilation ne réassemble pas son bytecode contre Guava 33. Aucun APK n’a été produit, donc les classes réellement empaquetées n’ont pas été inspectées. La compilation n’est pas une preuve d’exécution.

## Audit des deux Low

### `SNYK-JAVA-COMMONSCODEC-561518`

Avant correction : `commons-codec:commons-codec:1.10` sur `:app:releaseRuntimeClasspath` et `:app:releaseCompileClasspath`, via `host.exp.exponent:expo.modules.filesystem:19.0.23`. Absent du classpath AndroidTest.

Correctif appliqué sur toutes les configurations des deux `app/build.gradle` : `1.17.1`. Snyk indiquait `1.14` comme première version corrigée. `1.17.1` reste sur la ligne 1.x.

Après le scan : cet identifiant n’est plus ouvert sur `android/app/build.gradle` ni sur `apps/mobile/android/app/build.gradle`.

### `SNYK-JAVA-ORGJETBRAINSKOTLIN-2393744`

`kotlin-stdlib@1.8.21`, introduit par `com.google.testing.platform:android-test-plugin@0.0.9-alpha03`. Corrigé en amont à partir de `2.1.0`.

Sur le classpath release, Gradle résout `org.jetbrains.kotlin:kotlin-stdlib:2.1.20` (le plugin Kotlin du projet est déjà en `2.1.20`). La version `1.8.21` n’est pas celle du runtime livré. Elle reste visible par Snyk dans le graphe du plugin de test.

Elle n’a pas été forcée. Forcer `2.1.0` ou `2.1.20` sur la plateforme de test alpha n’a pas de preuve de non-régression, et le runtime release est déjà sur la version corrigée.

Le scan produit des deux modules `app` laisse exactement cet identifiant : **0 Critical, 0 High, 0 Medium, 1 Low**. Aucun ignore n’a été ajouté.

## Séparation proposée

Aucun commit n’a été créé. Proposition, à valider avant toute création :

1. Branche ou commit « remédiation Snyk » :
   - `vendor/deepmerge/`, `vendor/inflight/`, `vendor/open/`
   - `patches/@react-native__codegen@0.81.5.patch`
   - `package.json`, `pnpm-lock.yaml`
   - `android/app/build.gradle`
   - `scripts/deepmerge-cve-2026-93753.regression.test.mjs`
   - `scripts/inflight-memory-release.regression.test.mjs`
   - `scripts/open-cve-2026-119025.regression.test.mjs`
   - `scripts/codegen-minimatch-11.regression.test.mjs`
   - `scripts/image-size-clean-install.regression.test.mjs` (garde inflight / glob 7)
2. Branche ou commit GPS, à part :
   - `apps/mobile/src/components/location/MMDLocationPicker.tsx`
   - `apps/mobile/src/lib/verifiedClientGps.ts`
   - `apps/mobile/src/lib/verifiedClientGpsPure.ts`
   - `apps/mobile/src/screens/DeliveryRequestScreen.tsx`
   - `apps/mobile/src/screens/taxi/GuineaTaxiRequestScreen.tsx`
3. Branche ou commit i18n, à part : les douze fichiers `common.json` et `extras.json` de `en`, `fr`, `es`, `ar`, `zh`, `ff`.
4. Ne pas committer :
   - `apps/mobile/android/` (ignoré par Git)
   - `android/app/src/main/assets/` généré par la collecte de modules Sentry pendant la compilation locale

Tous ces fichiers sont encore dans l’arbre de travail. Aucun reset, aucun clean, aucune suppression.

## Fichiers Android ignorés

`apps/mobile/android/` est ignoré par `.gitignore` (`apps/mobile/android/`).

Diff entre `android/app/build.gradle` (suivi) et `apps/mobile/android/app/build.gradle` (ignoré) : le fichier suivi applique `sentry.gradle`. La copie ignorée ne l’applique pas. Le bloc `resolutionStrategy` (Guava, commons-io, commons-codec, Netty, protobuf) est le même dans les deux.

Conséquence : un scan ou un build lancé dans l’arbre ignoré ne sera pas ce que Git intègre. La configuration canonique est `android/` à la racine du dépôt, avec `android/app/build.gradle`, l’entrée `index.js` à la racine, et `metro.config.js` à la racine. C’est cet arbre qui a compilé.

## Snyk — sept cibles produit

CLI après les correctifs codegen et commons-codec. Organisation `diallomamadoumaladho62102-beep`. Les fichiers Gradle sous `node_modules` ne font pas partie de ces sept cibles. `snyk test --all-projects` les parcourt encore et y trouve des Critical. Ils n’ont pas été modifiés et ne sont pas le module application.

| Cible | Critical | High | Medium | Low |
| --- | ---: | ---: | ---: | ---: |
| Racine pnpm (748) | 0 | 0 | 0 | 0 |
| Mobile pnpm (751) | 0 | 0 | 0 | 0 |
| Web pnpm (474) | 0 | 0 | 0 | 0 |
| `android/build.gradle` | 0 | 0 | 0 | 0 |
| `apps/mobile/android/build.gradle` | 0 | 0 | 0 | 0 |
| `android/app/build.gradle` (295) | 0 | 0 | 0 | 1 |
| `apps/mobile/android/app/build.gradle` (314) | 0 | 0 | 0 | 1 |

Le Low restant est `SNYK-JAVA-ORGJETBRAINSKOTLIN-2393744` sur les deux modules `app`.

## Tests automatisés

| Commande | Résultat |
| --- | --- |
| `pnpm test:ci` | code 0, fin `2026-11-06T05:31:35Z`. Inclut deepmerge, inflight, open, codegen, politique `.snyk`, secret-scan (5248 fichiers, 0 finding), suite web et navigation. |
| `tsc --noEmit` racine, mobile, web | `TSC_OK` |
| `pnpm --dir apps/mobile test:i18n-locale` | code 0. RTL arabe, six langues, Guinée, checkout, `fullScreenI18n` (`ok`, 103 routes, 102 écrans, 3728 clés), chauffeurs à proximité. |
| `:app:compileReleaseKotlin` sur `android/` | `BUILD SUCCESSFUL` |

## Validations non réalisées

- Pixel 5 : `adb devices` n’a listé aucun appareil. `emulator-5554` n’était pas disponible. Aucun émulateur n’a été démarré ni réinitialisé. Aucun parcours visuel n’a été fait.
- iOS : non exécuté.
- Appareil physique : non exécuté.
- APK / AAB : non assemblés.
- Snyk Cloud : non actualisé. Aucun push. Aucun jeton lu.

Parcours à faire sur un Pixel 5 déjà allumé, sans créer de compte ni de commande :

1. Démarrage de MMD Delivery.
2. Navigation principale.
3. Connexion avec un compte de test déjà existant, puis déconnexion.
4. Les six langues : français, anglais, espagnol, arabe, chinois, peul.
5. RTL arabe.
6. Parcours du marché américain.
7. Parcours du marché guinéen (+224, GNF, sans transaction).

## Snyk Cloud après une future intégration

Les projets officiels suivent `main` sur la cible GitHub. Un scan CLI local ne les met pas à jour. Après une fusion autorisée :

1. Vérifier que `origin/main` contient le commit de fusion.
2. Dans l’interface Snyk, relancer le test des projets GitHub déjà importés, sans en créer de nouveaux et sans importer un `package.json` sans le lock pnpm.
3. Les projets à relire sont la racine pnpm, le mobile pnpm, le web pnpm, `android/app/build.gradle` et `android/build.gradle`.
4. Ne pas supprimer de projet. Ne pas ajouter d’ignore.

## Plan d’intégration proposé

À n’exécuter qu’après autorisation explicite.

1. Créer d’abord le commit ou la PR de remédiation Snyk seule, sans les fichiers GPS ni i18n, et sans `android/app/src/main/assets/`.
2. Ouvrir la PR vers `main`. Titre proposé : `fix: close Snyk high and critical dependency advisories`.
3. Attendre les contrôles GitHub. Ne pas fusionner si un contrôle échoue.
4. Méthode de fusion : celle déjà autorisée par le dépôt, sans force push.
5. Après fusion, vérifier `main`, `origin/main`, la CI et le déploiement Vercel automatique. Ne pas lancer de déploiement manuel, OTA ou EAS.
6. Les changements GPS et i18n restent dans l’arbre local pour une PR séparée.

## Risques restants

- Low Kotlin `1.8.21` dans le plugin de test Android. Le runtime release résout `2.1.20`.
- Les `build.gradle` sous `node_modules` gardent leurs propres Critical. Ils ne sont pas la configuration canonique.
- Guava `33.7.2-android` compile avec l’application. Le bytecode ExoPlayer et l’APK n’ont pas été inspectés.
- L’upload Sentry des source maps échoue sans jeton. Le SDK reste branché. Un build de publication qui doit envoyer les maps a besoin d’un jeton fourni par l’environnement de CI, pas par ce dépôt.
- Pixel 5, iOS, appareil physique et Snyk Cloud ne sont pas faits.
