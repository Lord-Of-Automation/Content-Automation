/**
 * What a run cost, worked out from the execution payload.
 *
 * DataForSEO states the price of every call in its own response, so that part
 * is exact. Anthropic reports token counts but not money, so it is priced from
 * rates below. Image generation reports neither, so it is counted and only
 * priced if a rate is configured. The split is kept visible rather than folded
 * into one number that looks more authoritative than it is.
 */

export type CostLine = {
  label: string;
  detail: string;
  /** Null when the work happened but no rate is configured to price it. */
  amount: number | null;
  exact: boolean;
};

export type CostBreakdown = {
  /** Everything that could be priced, in USD. */
  total: number;
  /** The part taken straight from a provider response. */
  exact: number;
  /** The part derived from configured rates. */
  estimated: number;
  lines: CostLine[];
  /** True when something was counted but could not be priced. */
  incomplete: boolean;
};

function rate(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

type Tally = {
  dfsCost: number;
  dfsCalls: number;
  models: Record<string, { input: number; output: number; calls: number }>;
  images: number;
};

/**
 * The payload is deeply nested and shaped differently per node, so rather than
 * encode every path this walks it looking for the three signatures that carry
 * cost. Binary keys are skipped: they hold base64 screenshots and nothing else.
 */
function tally(value: unknown, depth: number, acc: Tally): void {
  if (!value || typeof value !== "object" || depth > 8) return;

  if (Array.isArray(value)) {
    for (const item of value) tally(item, depth + 1, acc);
    return;
  }

  const node = value as Record<string, unknown>;

  // DataForSEO: a top-level cost alongside a tasks array.
  if (typeof node.cost === "number" && Array.isArray(node.tasks)) {
    acc.dfsCost += node.cost;
    acc.dfsCalls += 1;
  }

  // Anthropic messages: usage.input_tokens / output_tokens.
  const usage = node.usage as Record<string, unknown> | undefined;
  if (usage && typeof usage.input_tokens === "number") {
    const model = typeof node.model === "string" ? node.model : "unknown model";
    const bucket = (acc.models[model] ??= { input: 0, output: 0, calls: 0 });
    bucket.input += usage.input_tokens;
    bucket.output +=
      typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
    bucket.calls += 1;
  }

  // Gemini image generation: a candidates array.
  if (Array.isArray(node.candidates)) acc.images += 1;

  for (const key of Object.keys(node)) {
    if (key === "binary") continue;
    tally(node[key], depth + 1, acc);
  }
}

export function estimateCost(runData: unknown): CostBreakdown | null {
  if (!runData || typeof runData !== "object") return null;

  const acc: Tally = { dfsCost: 0, dfsCalls: 0, models: {}, images: 0 };
  tally(runData, 0, acc);

  const inputPerMTok = rate("COST_ANTHROPIC_INPUT_PER_MTOK", 3);
  const outputPerMTok = rate("COST_ANTHROPIC_OUTPUT_PER_MTOK", 15);
  const perImage = rate("COST_IMAGE_EACH", 0);

  const lines: CostLine[] = [];
  let exact = 0;
  let estimated = 0;
  let incomplete = false;

  if (acc.dfsCalls > 0) {
    exact += acc.dfsCost;
    lines.push({
      label: "DataForSEO",
      detail: `${acc.dfsCalls} API call${acc.dfsCalls === 1 ? "" : "s"}, priced by the API`,
      amount: acc.dfsCost,
      exact: true,
    });
  }

  for (const [model, t] of Object.entries(acc.models)) {
    const amount =
      (t.input / 1_000_000) * inputPerMTok + (t.output / 1_000_000) * outputPerMTok;
    estimated += amount;
    lines.push({
      label: model,
      detail:
        `${t.calls} call${t.calls === 1 ? "" : "s"}, ` +
        `${t.input.toLocaleString()} in / ${t.output.toLocaleString()} out tokens`,
      amount,
      exact: false,
    });
  }

  if (acc.images > 0) {
    if (perImage > 0) {
      const amount = acc.images * perImage;
      estimated += amount;
      lines.push({
        label: "Generated images",
        detail: `${acc.images} image${acc.images === 1 ? "" : "s"}`,
        amount,
        exact: false,
      });
    } else {
      incomplete = true;
      lines.push({
        label: "Generated images",
        detail: `${acc.images} image${acc.images === 1 ? "" : "s"}, set COST_IMAGE_EACH to price them`,
        amount: null,
        exact: false,
      });
    }
  }

  if (lines.length === 0) return null;

  return { total: exact + estimated, exact, estimated, lines, incomplete };
}
