# MMD Delivery — intégration finale sécurité, GPS et langues

Date : 2026-11-06.  
Branche de travail : `fix/snyk-deepmerge-cve-2026-93753`.  
Base connue avant intégration : `b07da172095a455dfd49c14975566d8992e8b87f` (`origin/main`, inchangé depuis le merge de la PR #179).  
Aucun `git reset --hard`, aucun `git clean`, aucun force push, aucun EAS, aucun OTA, aucun déploiement manuel.

**Verdict provisoire avant push : ORANGE.**  
Les corrections sont commitées et les contrôles locaux sont verts. Le push, GitHub CI, Vercel et Snyk Cloud sont vérifiés dans la section ajoutée après publication. Ce verdict est mis à jour à la fin du fichier une fois ces contrôles lus.

## 1. Vulnérabilités identifiées

| Avis | Paquet | Sévérité avant correction | Où il apparaissait |
| --- | --- | --- | --- |
| CVE-2026-93753 | `deepmerge@4.3.1` | Medium | `@expo/config` |
| SNYK-JS-INFLIGHT-6095116 | `inflight@1.0.6` | Medium, fuite mémoire | `glob@7.2.3`, React Native / Jest |
| CVE-2026-119025 / SNYK-JS-OPEN-22112123 | `open@7.4.2` et `open@8.4.2` | High | `@react-native/dev-middleware`, `@expo/cli` via `better-opn` |
| Deux avis Netty Critical | `io.netty` via gRPC 1.57.2 et 1.69.1 | Critical | configuration Gradle `unified-test-platform` seulement |
| CVE-2026-102554 | `guava:31.0.1-android` | High | ExoPlayer, classpath release |
| SNYK-JAVA-COMMONSIO-1277109 et 8161190 | `commons-io:2.6` | Medium | Expo FileSystem / DocumentPicker, runtime release |
| SNYK-JAVA-COMMONSCODEC-561518 | `commons-codec:1.10` | Low puis traité | `host.exp.exponent:expo.modules.filesystem:19.0.23`, runtime release |
| SNYK-JAVA-COMGOOGLEPROTOBUF-8055227 | `protobuf-java` | Low | test platform seulement |
| SNYK-JAVA-ORGJETBRAINSKOTLIN-2393744 | `kotlin-stdlib:1.8.21` | Low | plugin de test `android-test-plugin@0.0.9-alpha03` et demandeurs qui perdaient déjà la résolution release |

Les fichiers Gradle sous `node_modules` (exemples Expo) ne sont pas des cibles produit. Ils ne sont ni modifiés ni présentés comme le graphe de l'application.

## 2. Corrections appliquées

- `deepmerge` 4.3.2 local dans `vendor/deepmerge` : `propertyIsForbidden` écarte `__proto__`, `constructor` et `prototype`. Consommateurs vérifiés : les deux `@expo/config` installés. Licence MIT.
- `inflight` 1.0.7 local dans `vendor/inflight` : même API que 1.0.6, `FinalizationRegistry`, callbacks simultanés et exception couverts par test. `glob@7.2.3` conservé. Licence ISC. Le fichier `.snyk` n'ignore que `inflight@1.0.6` et n'a pas été élargi.
- `open` 8.4.3 local dans `vendor/open` : un seul paquet CommonJS sert `open@7.4.2` et `open@8.4.2`. Les arguments PowerShell sont entre apostrophes. Ce n'est pas `open@11`, qui est ESM-only et inutilisable par React Native 0.81.5. Licence MIT.
- Patch `patches/@react-native__codegen@0.81.5.patch` : le codegen ne passe plus par `glob.sync` / minimatch 11. Les sources `.js`, `.ts`, `.tsx` et `.fb.*` sont lues sur le disque.
- `android/app/build.gradle` force :
  - Guava `33.7.2-android` sur toutes les configurations ;
  - `commons-io` `2.18.0` ;
  - `commons-codec` `1.17.1` ;
  - `kotlin-stdlib` `2.1.20`, la version déjà sélectionnée par le runtime release et par le plugin Kotlin ;
  - Netty `4.1.138.Final` et `protobuf-java` `3.25.5` uniquement sur `unified-test-platform`.
- GPS : un fix non vérifié n'est pas enregistré. Le centre caméra de Conakry (`9.6412`, `-13.5784`) n'est pas accepté comme position GPS réelle quand la source n'est pas un fix appareil.
- Six catalogues `common.json` et `extras.json` : clés GPS ajoutées, aucune clé existante retirée.

Expo reste `~54.0.36`. React Native reste `0.81.5`. Sentry reste branché dans `android/app/build.gradle`. L'upload distant a été sauté uniquement pour la compilation locale avec `SENTRY_DISABLE_AUTO_UPLOAD=true`, parce que le jeton n'est pas disponible dans cet environnement. Le SDK n'est pas désactivé.

`apps/mobile/android/` est ignoré par Git. La même résolution y a été recopiée pour que le scan local de cette copie corresponde, mais le répertoire n'est pas commité.

## 3. Versions avant / après

| Composant | Avant | Après |
| --- | --- | --- |
| deepmerge | npm 4.3.1 | `file:vendor/deepmerge` 4.3.2 |
| inflight | npm 1.0.6 | `file:vendor/inflight` 1.0.7 |
| open 7.4.2 et 8.4.2 | npm | `file:vendor/open` 8.4.3 |
| Guava release | 31.0.1-android | 33.7.2-android |
| commons-io release | 2.6 | 2.18.0 |
| commons-codec release | 1.10 | 1.17.1 |
| Netty test platform | versions antérieures à 4.1.135 / 4.1.137 | 4.1.138.Final |
| protobuf-java test platform | version signalée | 3.25.5 |
| kotlin-stdlib test plugin | 1.8.21 | 2.1.20 |
| kotlin-stdlib release | 2.1.20 | 2.1.20 |
| Kotlin plugin application | 2.1.20 | 2.1.20 |

## 4. Snyk CLI — sept cibles produit

Scan du 2026-11-06 après le pin Kotlin, organisation `diallomamadoumaladho62102-beep`, CLI déjà authentifié. Aucun jeton lu.

| Cible | Dépendances | Critical | High | Medium | Low |
| --- | --- | --- | --- | --- | --- |
| Root `package.json` (pnpm) | 748 | 0 | 0 | 0 | 0 |
| `apps/mobile/package.json` | 751 | 0 | 0 | 0 | 0 |
| `apps/web/package.json` | 474 | 0 | 0 | 0 | 0 |
| `android/build.gradle` | — | 0 | 0 | 0 | 0 |
| `apps/mobile/android/build.gradle` | — | 0 | 0 | 0 | 0 |
| `android/app/build.gradle` | 291 | 0 | 0 | 0 | 0 |
| `apps/mobile/android/app/build.gradle` | 309 | 0 | 0 | 0 | 0 |

Le scan pnpm de cette passe a aussi vu des `package.json` générés sous `apps/web/.next` et deux lockfiles d'outils locaux. Ils sont à 0 et ne sont pas des cibles produit. Les Gradle de `node_modules` ont été exclus de cette passe. Les passes précédentes y trouvaient des Critical hérités des exemples Expo. Ces fichiers ne sont pas embarqués dans l'application et n'ont pas été édités.

## 5. Snyk Cloud

Les cinq projets GitHub officiels suivent `main` et ne voient pas les commits tant qu'ils ne sont pas poussés. Aucun nouveau projet n'est créé. L'état du dashboard après le push est ajouté en bas de ce fichier.

## 6. Tests automatisés

- `pnpm test:ci` : échec initial uniquement parce que le shell de compilation avait laissé `NODE_ENV=production`. Relancé sans cette variable : exit 0, environ 232 s. Secret scan : 5739 fichiers, 0 trouvaille. Inclut deepmerge, inflight, open, codegen, Stripe, Guinée, taxi, navigation, checkout et nearby drivers.
- `verifiedClientGps.test.ts` : OK.
- `pnpm --dir apps/mobile run test:i18n-locale` : exit 0. `fullScreenI18n` : 103 routes, 102 écrans, 3728 clés. RTL réservé à l'arabe. Langues FR, EN, ES, AR, ZH, FF.

## 7. TypeScript

`tsc --noEmit` racine, `apps/mobile` et `apps/web` : `TSC_OK`.

## 8. Six langues

Les douze fichiers `common.json` et `extras.json` sont dans le commit i18n. Les messages GPS d'erreur sont présents dans les six langues. Aucune traduction existante n'a été supprimée. Aucun texte TODO / TBD / lorem n'a été introduit par cette passe. Les tests de cohérence de locale sont verts.

## 9. GPS

`isGuineaMapCameraDefault` refuse `9.6412, -13.5784`. Le sélecteur n'accepte pas ce point comme position prête pour la Guinée lorsque la source n'est pas un fix GPS. Les codes d'erreur couvrent services coupés, permission refusée ou bloquée, précision faible, position périmée, timeout et position invalide. Taxi Guinée et demande de livraison passent par le même contrôle. Le test unitaire est vert. Aucune position fictive n'a été écrite en base.

## 10. Android release

- `:app:compileReleaseKotlin` après le pin Kotlin : `BUILD SUCCESSFUL`, tâche `UP-TO-DATE`. Plugin Kotlin 2.1.20.
- L'APK local déjà assemblé est `android/app/build/outputs/apk/release/app-release.apk`. Il est signé avec le keystore debug déjà configuré dans `signingConfigs`. Ce n'est pas un artefact Play. Aucun AAB n'a été produit. Aucun EAS.
- Le rapport SDK de cet assemblage contenait Guava `33.7.2-android`, commons-codec `1.17.1`, commons-io `2.18.0`, et ne contenait ni Netty ni `kotlin-stdlib@1.8.21`. Le pin Kotlin n'a pas changé la version déjà gagnante sur le classpath release, donc cet APK reste une preuve valable pour le runtime. Il n'est pas commité.
- L'upload Sentry de cette compilation locale est `SKIPPED`. L'intégration `sentry.gradle` reste appliquée.
- `android/app/src/main/assets/` généré par Sentry n'est pas commité.

## 11. Pixel 5

`adb devices -l` ne liste aucun appareil. `emulator-5554` n'est pas connecté. Aucun émulateur n'a été démarré ni réinitialisé. Aucun test visuel n'a été exécuté.

## 12. iOS et appareils physiques

Aucun test iOS, aucun appareil physique, aucune session Metro visuelle dans cette mission.

## 13. Fichiers modifiés et exclus

Commités : vendors, patch codegen, lockfile, scripts de régression, `android/app/build.gradle`, cinq fichiers GPS, douze catalogues, ce rapport et les mises à jour d'en-tête des rapports de phase.

Non commités : `apps/mobile/android/`, `android/app/src/main/assets/`, APK, caches Gradle, `node_modules`, secrets.

## 14. Commits

- `b141334c` `fix(security): vendor deepmerge, inflight, and open`
- `cfdad049` `fix(android): align release dependency resolution`
- `1f00a67c` `fix(mobile): require a verified GPS fix before saving position`
- `36376517` `fix(i18n): complete GPS messages in all six languages`

Le commit de documentation qui ajoute ce fichier suit ces quatre commits.

## 15. Push main

Voir la section de clôture. `main` n'avait pas de protection de branche ni de ruleset au moment du contrôle (`Branch not protected`, rulesets `[]`).

## 16. Hash final de main

Renseigné après le push.

## 17. GitHub CI

Renseigné après le push.

## 18. Vercel

Renseigné après le push. Aucun déploiement manuel n'est lancé. Le push sur `main` peut déclencher la production, ce qui est autorisé.

## 19. Problèmes restants

- L'APK de validation locale reste signé en debug. Il ne doit pas être envoyé au Play Store.
- L'upload des symboles Sentry n'a pas eu lieu en local, faute de jeton. Le SDK reste actif.
- Les exemples Gradle dans `node_modules` peuvent encore être signalés si un scan Snyk les parcourt. Ils ne font pas partie des sept cibles produit.
- `kotlin-stdlib-jdk8` 1.9.24 reste un artefact distinct déjà présent dans le rapport SDK release. L'avis traité visait `kotlin-stdlib`, pas cet artefact. Le scan applicatif après pin est à 0.

## 20. Validations externes non réalisées

- Pixel 5, iOS et appareil physique.
- Signature release Play et AAB.
- Upload Sentry.
- Écriture Supabase, compte, commande, transaction, activation de chauffeur, restaurant ou vendeur : aucune.
- Orange Money, cash GN, Stripe, formats téléphone et règles fiscales américaines : non modifiés.

## Marchés

États-Unis, Guinée (`+224`, GNF, code postal facultatif), Côte d'Ivoire et Sénégal : aucun changement de configuration marché, de paiement ou de téléphone dans ces commits. Les tests Guinée, Stripe, checkout et nearby drivers inclus dans `test:ci` sont verts.
