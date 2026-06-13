import { getOpenAiModel } from "@/lib/ai/aiConfig";

/** USD per 1M tokens — override via env for pricing updates without redeploy. */
export function getOpenAiInputUsdPer1M(): number {
  const raw = Number(process.env.OPENAI_INPUT_USD_PER_1M ?? 0.15);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0.15;
}

export function getOpenAiOutputUsdPer1M(): number {
  const raw = Number(process.env.OPENAI_OUTPUT_USD_PER_1M ?? 0.6);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0.6;
}

export type OpenAiUsageTotals = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  model: string;
};

export function estimateOpenAiCostUsd(params: {
  promptTokens: number;
  completionTokens: number;
  model?: string;
}): OpenAiUsageTotals {
  const promptTokens = Math.max(0, Math.trunc(params.promptTokens));
  const completionTokens = Math.max(0, Math.trunc(params.completionTokens));
  const totalTokens = promptTokens + completionTokens;
  const inputRate = getOpenAiInputUsdPer1M();
  const outputRate = getOpenAiOutputUsdPer1M();
  const estimatedCostUsd =
    (promptTokens * inputRate + completionTokens * outputRate) / 1_000_000;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(8)),
    model: params.model?.trim() || getOpenAiModel(),
  };
}

export function mergeOpenAiUsage(
  parts: OpenAiUsageTotals[]
): OpenAiUsageTotals {
  const promptTokens = parts.reduce((sum, p) => sum + p.promptTokens, 0);
  const completionTokens = parts.reduce((sum, p) => sum + p.completionTokens, 0);
  const estimatedCostUsd = parts.reduce((sum, p) => sum + p.estimatedCostUsd, 0);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(8)),
    model: parts[parts.length - 1]?.model ?? getOpenAiModel(),
  };
}
