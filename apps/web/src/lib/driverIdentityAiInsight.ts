import type { GlobalTrustScore } from "@/lib/driverIdentityTrustScore";

export type DriverAiInsight = {
  summary: string;
  riskExplanation: string[];
  unusualSignals: string[];
  recommendedChecks: string[];
  disclaimer: string;
};

export function buildDriverIdentityAiInsight(input: {
  triggerType: string | null;
  triggerReason: string | null;
  riskScore: number;
  requiresManualReview: boolean;
  trustScore: GlobalTrustScore;
  incidentCount: number;
  suspensionCount: number;
  securityChangeCount: number;
  acceptanceRate: number | null;
  cancellationRate: number | null;
}): DriverAiInsight {
  const riskExplanation: string[] = [];
  const unusualSignals: string[] = [];
  const recommendedChecks: string[] = [];

  if (input.riskScore >= 61) {
    riskExplanation.push(
      "Le score de risque du dossier actuel est élevé, ce qui déclenche une revue approfondie.",
    );
  } else if (input.riskScore >= 31) {
    riskExplanation.push(
      "Le score de risque est modéré ; certains signaux méritent une validation manuelle.",
    );
  } else {
    riskExplanation.push("Le score de risque actuel reste dans une zone acceptable.");
  }

  if (input.triggerReason) {
    riskExplanation.push(`Déclencheur : ${input.triggerReason}`);
  }

  if (input.trustScore.score < 55) {
    unusualSignals.push(
      `Score de confiance global faible (${input.trustScore.score}/100 — ${input.trustScore.label}).`,
    );
  }

  if (input.suspensionCount > 0) {
    unusualSignals.push(`${input.suspensionCount} suspension(s) antérieure(s) détectée(s).`);
  }

  if (input.incidentCount > 0) {
    unusualSignals.push(`${input.incidentCount} incident(s) client signalé(s).`);
  }

  if (input.securityChangeCount >= 3) {
    unusualSignals.push(
      `${input.securityChangeCount} changements de sécurité récents (téléphone, appareil, zone, etc.).`,
    );
  }

  if (input.cancellationRate != null && input.cancellationRate > 0.15) {
    unusualSignals.push(
      `Taux d'annulation élevé (${Math.round(input.cancellationRate * 100)}%).`,
    );
  }

  if (input.acceptanceRate != null && input.acceptanceRate < 0.7) {
    unusualSignals.push(
      `Taux d'acceptation bas (${Math.round(input.acceptanceRate * 100)}%).`,
    );
  }

  if (input.requiresManualReview) {
    recommendedChecks.push("Comparer selfie et photo KYC sous plusieurs angles.");
    recommendedChecks.push("Vérifier la cohérence ville / pays / dernière position.");
  }

  if (input.securityChangeCount > 0) {
    recommendedChecks.push("Contrôler les changements récents d'appareil, IP ou téléphone.");
  }

  if (input.incidentCount > 0) {
    recommendedChecks.push("Relire les signalements clients ouverts ou récents.");
  }

  if (recommendedChecks.length === 0) {
    recommendedChecks.push("Aucune vérification supplémentaire critique détectée.");
  }

  return {
    summary:
      unusualSignals.length > 0
        ? "Des signaux inhabituels nécessitent l'attention d'un Super Admin avant décision."
        : "Profil globalement cohérent ; la décision finale reste humaine.",
    riskExplanation,
    unusualSignals,
    recommendedChecks,
    disclaimer:
      "Analyse MMD AI en lecture seule — assistance décisionnelle uniquement. Le Super Admin conserve la décision finale.",
  };
}
