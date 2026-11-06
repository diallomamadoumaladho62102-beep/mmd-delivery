# MMD — Phase 4 : préparation d’intégration de la remédiation Snyk

> Document historique. L’intégration a été faite ensuite. Le résultat publié est dans `MMD-DELIVERY-FINAL-SECURITY-AND-INTEGRATION.md`.

Date : 2026-11-06.  
Branche : `fix/snyk-deepmerge-cve-2026-93753`.  
HEAD : `b07da172095a455dfd49c14975566d8992e8b87f`.  
`origin/main` : `b07da172095a455dfd49c14975566d8992e8b87f`.  
Aucun commit, aucun push, aucune PR distante, aucun merge, aucun déploiement.

**Verdict : ORANGE.**

Les sept cibles produit restent à 0 Critical, 0 High et 0 Medium. L’APK release local a été assemblé et ne contient pas `kotlin-stdlib@1.8.21` ni Netty. L’intégration n’est pas faite : un Low Snyk reste ouvert, Pixel 5, iOS, l’appareil physique et Snyk Cloud n’ont pas été exécutés, et l’autorisation de commit est encore requise.

## Low Kotlin — `SNYK-JAVA-ORGJETBRAINSKOTLIN-2393744`

Avis : Information Exposure dans `org.jetbrains.kotlin:kotlin-stdlib`, corrigé en amont à partir de `2.1.0`.

Snyk l’introduit, dans le graphe du module `app`, par :

`app > com.google.testing.platform:android-test-plugin@0.0.9-alpha03 > kotlin-stdlib@1.8.21`

et 11 autres chemins du même graphe. Ce plugin appartient à la plateforme de test Android, pas au classpath livré.

Sur `:app:releaseRuntimeClasspath`, Gradle ne sélectionne pas `1.8.21` :

- `kotlin-stdlib` demandé à `1.8.21` par `androidx.tracing:tracing-ktx:1.2.0` (`expo-modules-core`, `androidx.camera:camera-lifecycle`) est résolu en **`2.1.20`** par résolution de conflit.
- `kotlin-stdlib-jdk8` demandé à `1.8.21` par `com.squareup.okhttp3:okhttp:4.12.0` (Mapbox, Expo Updates) est résolu en **`1.9.24`**.
- La version sélectionnée de `kotlin-stdlib` est `2.1.20`. Le plugin Kotlin du projet est `2.1.20`.

Aucune version n’a été forcée. L’alerte n’a pas été masquée.

### Artefact destiné aux utilisateurs

APK : `android/app/build/outputs/apk/release/app-release.apk`.  
Le rapport AGP `sdk-dependencies/release/sdkDependencies.txt` de cette variante contient :

| Artefact | Version dans l’APK |
| --- | --- |
| `kotlin-stdlib` | `2.1.20` |
| `kotlin-stdlib-jdk7` | `2.1.20` |
| `kotlin-stdlib-common` | `2.1.20` |
| `kotlin-stdlib-jdk8` | `1.9.24` |
| `kotlin-stdlib@1.8.21` | absent (0 occurrence) |
| `io.netty` | absent (0 occurrence) |
| `guava` | `33.7.2-android` |
| `commons-codec` | `1.17.1` |
| `commons-io` | `2.18.0` |

`kotlin-tooling-metadata.json` dans l’APK annonce `buildPluginVersion` `2.1.20`. Les sept fichiers `classes*.dex` ne contiennent pas la chaîne `1.8.21` ni `io/netty`. Ils contiennent `com/google/common/base` et `org/apache/commons/codec`. Aucune entrée zip ne porte le nom Netty ou Guava : ces bibliothèques sont dans le dex, pas dans des jars séparés.

Risque résiduel : Snyk continue de voir `kotlin-stdlib@1.8.21` dans le graphe du plugin de test. Ce n’est pas la version sélectionnée ni empaquetée pour la release. `kotlin-stdlib-jdk8@1.9.24` est, lui, dans le rapport SDK release. Ce n’est pas l’artefact signalé par cet identifiant Snyk, et le scan du module `app` n’ouvre pas d’autre avis dessus. Forcer toute la ligne Kotlin du plugin de test n’a pas été fait.

## Assemblage Android release

Premier essai, `GRADLE_USER_HOME` pointait vers le cache sandbox Cursor. Ninja a échoué sur `:react-native-screens:buildCMakeRelWithDebInfo[arm64-v8a]` et `:expo-modules-core:buildCMakeRelWithDebInfo[arm64-v8a]` :

`Filename longer than 260 characters` sur `libreactnative.so` dans ce cache.

Second essai, même tâche `:app:assembleRelease`, avec `GRADLE_USER_HOME` = `%USERPROFILE%\.gradle`, `NODE_ENV=production`, `SENTRY_DISABLE_AUTO_UPLOAD=true`.  
**BUILD SUCCESSFUL in 10m 51s.**  
L’upload Sentry est SKIPPED. `sentry.gradle` reste appliqué. Aucun jeton n’a été lu.

L’APK fait 246 905 893 octets. `applicationId` `com.maladho2025.mmddelivery`, `versionName` `1.0.0`, `versionCode` 1. Le type release du projet signe déjà avec `signingConfigs.debug` et le keystore de debug. Cet APK sert à la validation locale. Ce n’est pas un artefact Play. Aucun AAB n’a été demandé ni produit. Aucun EAS, aucun BUILD ALL, aucun déploiement.

## Snyk — sept cibles produit

Scan CLI `--all-projects` après l’assemblage. `--exclude=node_modules` n’a pas empêché Snyk de lire les `build.gradle` sous `node_modules`. Ces fichiers ne sont pas les sept cibles. Ils gardent des Critical. Ils n’ont pas été modifiés.

| Cible | Critical | High | Medium | Low |
| --- | ---: | ---: | ---: | ---: |
| Racine pnpm (748) | 0 | 0 | 0 | 0 |
| Mobile pnpm (751) | 0 | 0 | 0 | 0 |
| Web pnpm (474) | 0 | 0 | 0 | 0 |
| `android/build.gradle` | 0 | 0 | 0 | 0 |
| `apps/mobile/android/build.gradle` | 0 | 0 | 0 | 0 |
| `android/app/build.gradle` (295) | 0 | 0 | 0 | 1 |
| `apps/mobile/android/app/build.gradle` (314) | 0 | 0 | 0 | 1 |

Le Low des deux modules `app` est `SNYK-JAVA-ORGJETBRAINSKOTLIN-2393744`.

## Tests

| Commande | Résultat |
| --- | --- |
| `pnpm test:ci` | code 0, fin `2026-11-06T05:53:54Z`. deepmerge, inflight, open, codegen, secret-scan (5249 fichiers, 0 finding), suite web, navigation. |
| `tsc --noEmit` racine, mobile, web | `TSC_OK` |
| `pnpm --dir apps/mobile test:i18n-locale` | code 0. Six langues, RTL arabe, `fullScreenI18n` ok (103 routes, 102 écrans, 3728 clés). |
| `:app:assembleRelease` | `BUILD SUCCESSFUL` au second essai. |

## Diff du groupe sécurité

Fichiers proposés pour la PR, et seulement ceux-là :

- `vendor/deepmerge/` — MIT, copyright 2012 James Halliday, Josh Duff, and other contributors, `license.txt`
- `vendor/inflight/` — ISC, copyright Isaac Z. Schlueter, `LICENSE`
- `vendor/open/` — MIT, copyright Sindre Sorhus, `license`
- `patches/@react-native__codegen@0.81.5.patch`
- `package.json` — overrides `deepmerge`, `inflight`, `open@7.4.2`, `open@8.4.2`, `patchedDependencies`, et les quatre scripts ajoutés à `test:ci`
- `pnpm-lock.yaml` — résolutions `file:vendor/...` et patch codegen hash `87cf80d0905cb109c416f3539ea6d0094f1d76f628044a5249df424cd9ae38a1`
- `android/app/build.gradle` — uniquement le `resolutionStrategy` (Guava `33.7.2-android`, commons-io `2.18.0`, commons-codec `1.17.1`, Netty `4.1.138.Final` et protobuf `3.25.5` limités à la plateforme de test)
- `scripts/deepmerge-cve-2026-93753.regression.test.mjs`
- `scripts/inflight-memory-release.regression.test.mjs`
- `scripts/open-cve-2026-119025.regression.test.mjs`
- `scripts/codegen-minimatch-11.regression.test.mjs`
- `scripts/image-size-clean-install.regression.test.mjs` — le diff remplace l’attente de `inflight@1.0.6` par le vendor `1.0.7`

Le fichier installé `node_modules/@react-native/codegen/lib/cli/combine/combine-js-to-schema.js` contient `CODEGEN_SOURCE`. Le lock enregistre le patch. pnpm l’applique.

Ce groupe ne contient aucun fichier GPS, aucun catalogue i18n, aucun secret, aucun fichier temporaire, et pas `android/app/src/main/assets/` généré par la collecte Sentry.

Les rapports sous `docs/production/reports/` sont ignorés par Git. Ils restent locaux. Les ajouter à la PR demanderait de modifier `.gitignore`. Ce n’est pas fait.

## Groupes laissés à part

GPS, non inclus :

- `apps/mobile/src/components/location/MMDLocationPicker.tsx`
- `apps/mobile/src/lib/verifiedClientGps.ts`
- `apps/mobile/src/lib/verifiedClientGpsPure.ts`
- `apps/mobile/src/screens/DeliveryRequestScreen.tsx`
- `apps/mobile/src/screens/taxi/GuineaTaxiRequestScreen.tsx`

i18n, non inclus : les douze `common.json` et `extras.json` de `en`, `fr`, `es`, `ar`, `zh`, `ff`.

`apps/mobile/android/` n’a pas été modifié dans cette phase. Il reste ignoré par Git.

Aucun commit n’a séparé physiquement l’index Git. L’arbre de travail contient encore les trois groupes. La séparation est la liste de fichiers de la PR.

## PR proposée, non créée

Titre : `fix: close Snyk high and critical dependency advisories`

Description :

```
## Summary
- Replace vulnerable deepmerge, inflight, and open with audited vendored copies, and keep Expo 54.0.36 / React Native 0.81.5.
- Force the Android app classpath off vulnerable Guava, commons-io, and commons-codec; keep Netty 4.1.138 only on the test-platform configuration.
- Patch @react-native/codegen so glob 7 is not called against minimatch 11 during Sentry codegen.

## Tests
- pnpm test:ci, tsc (root, mobile, web), and six-language i18n passed.
- :app:assembleRelease produced a local release APK. Guava 33.7.2-android, commons-codec 1.17.1, and kotlin-stdlib 2.1.20 are in the release SDK report. kotlin-stdlib 1.8.21 and Netty are not in the APK.
- Product Snyk targets: 0 Critical, 0 High, 0 Medium, 1 Low (kotlin-stdlib requested by the Android test plugin, not packaged).

## Residual risk
- SNYK-JAVA-ORGJETBRAINSKOTLIN-2393744 stays visible on the app Gradle graph. Release resolution and the APK use kotlin-stdlib 2.1.20.
- node_modules Android build files are third-party and still report their own issues.
- The local APK is signed with the debug keystore already configured for this release build type. It is not a Play artifact.
- Snyk Cloud, Pixel 5, iOS, and a physical device were not part of this run.
```

## Limites

- Le Low Kotlin reste ouvert dans Snyk.
- Les `build.gradle` sous `node_modules` ne sont pas corrigés.
- Pas de Pixel 5, pas d’iOS, pas d’appareil physique, pas de Snyk Cloud.
- Pas d’AAB.
- `main` n’a pas bougé.

L’autorisation reste nécessaire avant tout commit, push, PR distante ou merge.
