import assert from "node:assert/strict";
import { isTechnicalErrorMessage, toUserFacingError } from "./userFacingError";

function testTechnicalPatterns() {
  assert.equal(isTechnicalErrorMessage("unrecognized format() type specifier"), true);
  assert.equal(isTechnicalErrorMessage("Mapbox directions failed (422)"), true);
  assert.equal(isTechnicalErrorMessage("Impossible de sauvegarder (driver_profiles)"), true);
  assert.equal(isTechnicalErrorMessage("Votre carte a été refusée."), false);
}

function testKnownCodes() {
  assert.equal(
    toUserFacingError({ error: "documents_required" }),
    "Ce mode de transport nécessite une validation de vos documents avant d'être activé.",
  );
  assert.equal(
    toUserFacingError({ error: "route_unavailable" }),
    "Nous n'avons pas pu calculer l'itinéraire exact pour le moment. Veuillez vérifier les adresses ou réessayer.",
  );
  assert.equal(
    toUserFacingError({ code: "active_mission_in_progress" }),
    "Terminez votre mission en cours avant de modifier ce paramètre.",
  );
}

function testTechnicalFallback() {
  assert.equal(
    toUserFacingError(new Error("Postgres error 500 on driver_vehicles")),
    "Une action temporairement impossible s'est produite. Veuillez réessayer.",
  );
  assert.equal(
    toUserFacingError(new Error("Postgres error 500 on driver_vehicles"), "Message personnalisé."),
    "Message personnalisé.",
  );
}

function testStripeMessages() {
  assert.equal(
    toUserFacingError({ message: "Une erreur de traitement est survenue." }),
    "Le paiement n'a pas pu être finalisé. Réessayez dans quelques instants.",
  );
}

function testDeliverySharePctUserMessage() {
  assert.equal(
    isTechnicalErrorMessage("driverSharePct + platformSharePct must be <= 100."),
    true,
  );
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
testTechnicalFallback();
testStripeMessages();
testDeliverySharePctUserMessage();

console.log("userFacingError.test.ts OK");
