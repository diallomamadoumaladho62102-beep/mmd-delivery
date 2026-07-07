import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

type ExportPayload = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = "—"): string {
  if (value == null || value === "") return fallback;
  return String(value);
}

function formatDateTime(value: unknown): string {
  if (value == null) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fr-FR");
}

function drawWrappedText(
  page: PDFPage,
  font: PDFFont,
  input: {
    text: string;
    x: number;
    y: number;
    maxWidth: number;
    size: number;
    color?: ReturnType<typeof rgb>;
    lineHeight?: number;
  },
): number {
  const words = input.text.split(/\s+/);
  let line = "";
  let y = input.y;
  const lineHeight = input.lineHeight ?? input.size + 4;
  const color = input.color ?? rgb(0.15, 0.15, 0.15);

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, input.size);
    if (width > input.maxWidth && line) {
      page.drawText(line, {
        x: input.x,
        y,
        size: input.size,
        font,
        color,
      });
      line = word;
      y -= lineHeight;
    } else {
      line = candidate;
    }
  }

  if (line) {
    page.drawText(line, {
      x: input.x,
      y,
      size: input.size,
      font,
      color,
    });
    y -= lineHeight;
  }

  return y;
}

function drawSectionTitle(
  page: PDFPage,
  fontBold: PDFFont,
  title: string,
  y: number,
): number {
  page.drawText(title, {
    x: 48,
    y,
    size: 13,
    font: fontBold,
    color: rgb(0.05, 0.2, 0.45),
  });
  return y - 22;
}

function drawKeyValue(
  page: PDFPage,
  font: PDFFont,
  label: string,
  value: string,
  y: number,
): number {
  page.drawText(`${label}: ${value}`, {
    x: 56,
    y,
    size: 10,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });
  return y - 14;
}

export async function buildDriverIdentityInvestigationPdf(
  payload: ExportPayload,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([595, 842]);
  let y = 800;

  page.drawText("MMD — Dossier investigation identité chauffeur", {
    x: 48,
    y,
    size: 16,
    font: fontBold,
    color: rgb(0.05, 0.15, 0.35),
  });
  y -= 24;

  y = drawKeyValue(page, font, "Exporté le", formatDateTime(payload.exported_at), y);
  y = drawKeyValue(page, font, "Dossier", text(payload.check_id), y);
  y = drawKeyValue(page, font, "Chauffeur", text(payload.driver_id), y);

  const check = asRecord(payload.check);
  y = drawKeyValue(page, font, "Statut", text(check.status), y);
  y = drawKeyValue(page, font, "Risque", text(check.risk_score), y);
  y = drawKeyValue(page, font, "Déclencheur", text(check.trigger_type), y);

  const driverHistory = asRecord(payload.driver_history);
  y -= 8;
  y = drawSectionTitle(page, fontBold, "Historique chauffeur", y);
  y = drawKeyValue(page, font, "Courses totales", text(driverHistory.total_trips), y);
  y = drawKeyValue(
    page,
    font,
    "Taux d'acceptation",
    driverHistory.acceptance_rate == null
      ? "—"
      : `${Math.round(Number(driverHistory.acceptance_rate) * 100)}%`,
    y,
  );
  y = drawKeyValue(
    page,
    font,
    "Taux d'annulation",
    driverHistory.cancellation_rate == null
      ? "—"
      : `${Math.round(Number(driverHistory.cancellation_rate) * 100)}%`,
    y,
  );
  y = drawKeyValue(page, font, "Note moyenne", text(driverHistory.average_rating), y);
  y = drawKeyValue(page, font, "Ancienneté", text(driverHistory.seniority_label), y);
  y = drawKeyValue(page, font, "Suspensions", text(driverHistory.suspension_count), y);
  y = drawKeyValue(
    page,
    font,
    "Vérifications précédentes",
    text(driverHistory.previous_verifications),
    y,
  );
  y = drawKeyValue(
    page,
    font,
    "Incidents signalés",
    text(driverHistory.reported_incidents),
    y,
  );

  const trustScore = asRecord(payload.trust_score);
  y -= 8;
  y = drawSectionTitle(page, fontBold, "Score de confiance global", y);
  y = drawKeyValue(
    page,
    font,
    "Score",
    `${text(trustScore.score, "0")} / 100 — ${text(trustScore.label)}`,
    y,
  );

  const geography = asRecord(payload.geography);
  y -= 8;
  y = drawSectionTitle(page, fontBold, "Géographie récente", y);
  y = drawKeyValue(page, font, "Ville", text(geography.city), y);
  y = drawKeyValue(page, font, "Pays", text(geography.country), y);
  y = drawKeyValue(page, font, "Zone", text(geography.zone), y);
  const lastPosition = asRecord(geography.last_position);
  if (lastPosition.lat != null && lastPosition.lng != null) {
    y = drawKeyValue(
      page,
      font,
      "Dernière position",
      `${lastPosition.lat}, ${lastPosition.lng} (${formatDateTime(lastPosition.updated_at)})`,
      y,
    );
  }

  const aiInsight = asRecord(payload.ai_insight);
  y -= 8;
  y = drawSectionTitle(page, fontBold, "Analyse MMD AI (lecture seule)", y);
  y = drawWrappedText(page, font, {
    text: text(aiInsight.summary),
    x: 56,
    y,
    maxWidth: 480,
    size: 10,
  });
  y -= 6;
  y = drawWrappedText(page, font, {
    text: text(aiInsight.disclaimer),
    x: 56,
    y,
    maxWidth: 480,
    size: 9,
    color: rgb(0.4, 0.4, 0.4),
  });

  page = pdf.addPage([595, 842]);
  y = 800;

  const securityHistory = asRecord(payload.security_history);
  y = drawSectionTitle(page, fontBold, "Historique sécurité", y);
  const changes = asArray(securityHistory.changes).slice(0, 25);
  if (changes.length === 0) {
    y = drawKeyValue(page, font, "Changements", "Aucun enregistré", y);
  } else {
    for (const entry of changes) {
      const row = asRecord(entry);
      if (y < 72) {
        page = pdf.addPage([595, 842]);
        y = 800;
      }
      y = drawKeyValue(
        page,
        font,
        text(row.label),
        `${text(row.value)} — ${formatDateTime(row.at)}`,
        y,
      );
    }
  }

  y -= 8;
  y = drawSectionTitle(page, fontBold, "Audit consultations dossier", y);
  const viewAudit = asRecord(payload.view_audit);
  const auditEntries = asArray(viewAudit.entries).slice(0, 20);
  if (auditEntries.length === 0) {
    y = drawKeyValue(page, font, "Consultations", "Aucune entrée", y);
  } else {
    for (const entry of auditEntries) {
      const row = asRecord(entry);
      if (y < 72) {
        page = pdf.addPage([595, 842]);
        y = 800;
      }
      y = drawKeyValue(
        page,
        font,
        formatDateTime(row.created_at),
        `${text(row.action)}${row.section ? ` (${text(row.section)})` : ""} — IP ${text(row.ip_address, "n/a")}`,
        y,
      );
    }
  }

  page.drawText("Document généré par MMD Control Center — décision humaine requise.", {
    x: 48,
    y: 36,
    size: 8,
    font,
    color: rgb(0.45, 0.45, 0.45),
  });

  return pdf.save();
}
