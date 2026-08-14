import assert from "node:assert/strict";
import i18n from "i18next";
import { resources } from "../i18n/resources";
import { isTechnicalErrorMessage, toUserFacingError } from "./userFacingError";

function testTechnicalPatterns() {
  assert.equal(isTechnicalErrorMessage("unrecognized format() type specifier"), true);
  assert.equal(isTechnicalErrorMessage("Mapbox directions failed (422)"), true);
  assert.equal(isTechnicalErrorMessage("Request failed (500)"), true);
}

function testKnownCodesFrench() {
  assert.equal(
    toUserFacingError({ error: "documents_required" }),
    "Ce mode de transport nécessite une validation de vos documents avant d'être activé.",
  );
  assert.equal(
    toUserFacingError({ error: "no_active_vehicle" }),
    "Sélectionnez un véhicule actif et approuvé avant de passer en ligne.",
  );
  assert.equal(
    toUserFacingError({ error: "vehicle_pending_review" }),
    "Votre véhicule est en attente de validation. Vous pourrez passer en ligne après approbation.",
  );
}

function testStripeGenericFrench() {
  assert.equal(
    toUserFacingError({ message: "Une erreur de traitement est survenue." }),
    "Le paiement n'a pas pu être finalisé. Réessayez dans quelques instants.",
  );
}

function testDeliverySharePctUserMessage() {
  assert.equal(isTechnicalErrorMessage("driverSharePct + platformSharePct must be <= 100."), true);
  assert.equal(
    toUserFacingError({
      code: "delivery_share_pct_invalid",
      message: "driverSharePct + platformSharePct must be <= 100.",
    }),
    "La configuration de livraison est temporairement indisponible. Réessayez plus tard ou contactez le support.",
  );
  assert.equal(
    toUserFacingError(new Error("driverSharePct + platformSharePct must be <= 100.")),
    "La configuration de livraison est temporairement indisponible. Réessayez plus tard ou contactez le support.",
  );
}

function testFallbackFollowsLanguage() {
  assert.equal(
    toUserFacingError(new Error("Request failed (500)")),
    "Une action temporairement impossible s'est produite. Veuillez réessayer.",
  );
}

function testEnglishAfterLanguageSwitch() {
  assert.equal(
    toUserFacingError({ error: "documents_required" }),
    "This transport mode requires your documents to be approved before it can be enabled.",
  );
  assert.equal(
    toUserFacingError({ message: "Card was declined." }),
    "Your card was declined. Check your details or use another card.",
  );
  assert.equal(
    toUserFacingError(new Error("Request failed (500)")),
    "Something went wrong temporarily. Please try again.",
  );
}

function testExplicitFallbackStillWins() {
  assert.equal(
    toUserFacingError(new Error("Request failed (500)"), "Custom fallback"),
    "Custom fallback",
  );
}

async function main() {
  await i18n.init({
    resources: resources as unknown as Record<string, unknown>,
    lng: "fr",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
    keySeparator: ".",
    nsSeparator: ":",
    defaultNS: "translation",
  });

  testTechnicalPatterns();
  testKnownCodesFrench();
  testStripeGenericFrench();
  testDeliverySharePctUserMessage();
  testFallbackFollowsLanguage();
  testExplicitFallbackStillWins();

  await i18n.changeLanguage("en");
  testEnglishAfterLanguageSwitch();

  console.log("userFacingError.test.ts OK");
}

void main();
