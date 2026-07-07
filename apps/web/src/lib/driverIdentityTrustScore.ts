export type GlobalTrustBand = "excellent" | "good" | "average" | "elevated" | "critical";

export type GlobalTrustScore = {
  score: number;
  band: GlobalTrustBand;
  label: string;
  factors: Array<{ key: string; label: string; impact: number }>;
};

const BAND_LABELS: Record<GlobalTrustBand, string> = {
  excellent: "Excellent",
  good: "Bon",
  average: "Moyen",
  elevated: "Élevé",
  critical: "Critique",
};

export function globalTrustBandLabel(band: GlobalTrustBand): string {
  return BAND_LABELS[band];
}

export function globalTrustBandBadgeClass(band: GlobalTrustBand): string {
  switch (band) {
    case "excellent":
      return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200";
    case "good":
      return "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/60 dark:text-green-200";
    case "average":
      return "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-200";
    case "elevated":
      return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200";
    case "critical":
      return "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200";
  }
}

export function resolveGlobalTrustBand(score: number): GlobalTrustBand {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 55) return "average";
  if (score >= 40) return "elevated";
  return "critical";
}

export function computeGlobalTrustScore(input: {
  seniorityDays: number;
  totalTrips: number;
  acceptanceRate: number | null;
  cancellationRate: number | null;
  averageRating: number | null;
  suspensionCount: number;
  previousVerificationCount: number;
  incidentCount: number;
  currentRiskScore: number;
}): GlobalTrustScore {
  let score = 72;
  const factors: GlobalTrustScore["factors"] = [];

  const seniorityBonus = Math.min(12, Math.floor(input.seniorityDays / 30));
  score += seniorityBonus;
  factors.push({
    key: "seniority",
    label: `Ancienneté (${input.seniorityDays} j)`,
    impact: seniorityBonus,
  });

  const activityBonus = Math.min(10, Math.floor(input.totalTrips / 25));
  score += activityBonus;
  factors.push({
    key: "activity",
    label: `Activité (${input.totalTrips} courses)`,
    impact: activityBonus,
  });

  if (input.averageRating != null) {
    const ratingImpact = Math.round((input.averageRating - 3) * 8);
    score += ratingImpact;
    factors.push({
      key: "rating",
      label: `Note moyenne (${input.averageRating.toFixed(1)})`,
      impact: ratingImpact,
    });
  }

  if (input.acceptanceRate != null) {
    const acceptanceImpact = Math.round((input.acceptanceRate - 0.8) * 20);
    score += acceptanceImpact;
    factors.push({
      key: "acceptance",
      label: `Taux d'acceptation (${Math.round(input.acceptanceRate * 100)}%)`,
      impact: acceptanceImpact,
    });
  }

  if (input.cancellationRate != null) {
    const cancelImpact = -Math.round(input.cancellationRate * 25);
    score += cancelImpact;
    factors.push({
      key: "cancellation",
      label: `Taux d'annulation (${Math.round(input.cancellationRate * 100)}%)`,
      impact: cancelImpact,
    });
  }

  const suspensionImpact = -Math.min(30, input.suspensionCount * 12);
  score += suspensionImpact;
  factors.push({
    key: "suspensions",
    label: `Suspensions (${input.suspensionCount})`,
    impact: suspensionImpact,
  });

  const incidentImpact = -Math.min(24, input.incidentCount * 8);
  score += incidentImpact;
  factors.push({
    key: "incidents",
    label: `Incidents signalés (${input.incidentCount})`,
    impact: incidentImpact,
  });

  const verificationBonus = Math.min(8, input.previousVerificationCount * 2);
  score += verificationBonus;
  factors.push({
    key: "verifications",
    label: `Vérifications passées (${input.previousVerificationCount})`,
    impact: verificationBonus,
  });

  const riskImpact = -Math.round(Number(input.currentRiskScore ?? 0) * 0.25);
  score += riskImpact;
  factors.push({
    key: "current_risk",
    label: `Risque dossier actuel (${input.currentRiskScore})`,
    impact: riskImpact,
  });

  const normalized = Math.max(0, Math.min(100, Math.round(score)));
  const band = resolveGlobalTrustBand(normalized);

  return {
    score: normalized,
    band,
    label: globalTrustBandLabel(band),
    factors,
  };
}
