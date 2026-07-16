import assert from "node:assert/strict";
import { isTechnicalErrorMessage, toUserFacingError } from "./userFacingError";

function testTechnicalPatterns() {
  assert.equal(isTechnicalErrorMessage("unrecognized format() type specifier"), true);
  assert.equal(isTechnicalErrorMessage("Mapbox directions failed (422)"), true);
  assert.equal(isTechnicalErrorMessage("Request failed (500)"), true);
}

function testKnownCodes() {
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

testTechnicalPatterns();
testKnownCodes();
testStripeGenericFrench();
testDeliverySharePctUserMessage();

console.log("userFacingError.test.ts OK");

