import { OkxCredentials, SwapQuote, SwapRequest, RouteComparison, fromMinimalUnits, resolveSymbol, sourceLabel } from "./types";
import * as onchainos from "./onchainos";
import * as uniswap from "./uniswap";

/**
 * Fetches quotes from both OnchainOS DEX aggregator and Uniswap in parallel,
 * then returns the best route based on output amount.
 */
export async function findBestRoute(
  request: SwapRequest,
  okxCreds: OkxCredentials
): Promise<RouteComparison> {
  const { fromToken, toToken, amount, walletAddress } = request;

  // Query both sources in parallel. OKX may be geoblocked on some networks;
  // cap its wait time so a blocked OKX never holds up a Uniswap-only swap.
  const OKX_TIMEOUT_MS = 4000;
  const withTimeout = <T,>(p: Promise<T | null>, ms: number): Promise<T | null> =>
    Promise.race([
      p,
      new Promise<T | null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);

  const [okxQuote, uniQuote] = await Promise.all([
    withTimeout(onchainos.getQuote(okxCreds, fromToken, toToken, amount).catch(() => null), OKX_TIMEOUT_MS),
    uniswap.getQuote(fromToken, toToken, amount, walletAddress).catch(() => null),
  ]);

  const quotes: SwapQuote[] = [];
  if (okxQuote) quotes.push(okxQuote);
  if (uniQuote) quotes.push(uniQuote);

  if (quotes.length === 0) {
    throw new Error(
      "No quotes available from either OnchainOS or Uniswap. " +
      "Check that the token pair is valid on X Layer."
    );
  }

  // Sort by output amount (highest first = best deal)
  quotes.sort((a, b) => {
    const amountA = BigInt(a.toAmount);
    const amountB = BigInt(b.toAmount);
    if (amountA > amountB) return -1;
    if (amountA < amountB) return 1;
    return 0;
  });

  const best = quotes[0];
  const worst = quotes[quotes.length - 1];

  // Calculate savings (difference between best and worst)
  let savings = "0";
  if (quotes.length > 1) {
    const diff = BigInt(best.toAmount) - BigInt(worst.toAmount);
    savings = diff.toString();
  }

  return { best, all: quotes, savings };
}

/**
 * Formats a route comparison into a human-readable summary.
 */
export function formatComparison(comparison: RouteComparison): string {
  const lines: string[] = [];

  lines.push("=== Swap Route Comparison ===\n");

  const toToken = comparison.best.toToken;
  const toSymbol = resolveSymbol(toToken);

  // Always render both aggregators side-by-side so the user can see the
  // comparison that drove the winner — even if only one returned a quote.
  const expected: Array<"onchainos" | "uniswap"> = ["onchainos", "uniswap"];
  const byName: Record<string, SwapQuote | undefined> = {};
  for (const q of comparison.all) byName[q.source] = q;

  const col = (s: string, w: number) => (s.length >= w ? s : s + " ".repeat(w - s.length));
  lines.push(
    col("Aggregator", 18) + col("Output", 28) + col("Gas (units)", 14) + col("Impact", 10) + "Status"
  );
  lines.push("-".repeat(80));

  const fmtGas = (g: string) => {
    if (!g || g === "0") return "-";
    const n = Number(g);
    if (!isFinite(n)) return g;
    return `~${n.toLocaleString("en-US")}`;
  };

  for (const src of expected) {
    const q = byName[src];
    const label = sourceLabel(src);
    if (!q) {
      lines.push(col(label, 18) + col("no route on X Layer", 28) + col("-", 14) + col("-", 10) + "-");
      continue;
    }
    const output = `${fromMinimalUnits(q.toAmount, toToken)} ${toSymbol}`;
    const gas = fmtGas(q.estimatedGas);
    const impact = `${parseFloat(q.priceImpact || "0").toFixed(2)}%`;
    const status = q === comparison.best ? "** WINNER **" : "";
    lines.push(col(label, 18) + col(output, 28) + col(gas, 14) + col(impact, 10) + status);
  }

  lines.push("");
  for (const src of expected) {
    const q = byName[src];
    if (!q) continue;
    lines.push(`  ${sourceLabel(src)} route: ${q.routePath.join(" -> ")}`);
  }

  if (comparison.all.length > 1 && comparison.savings !== "0") {
    lines.push(`\nSavings with best route: ${fromMinimalUnits(comparison.savings, toToken)} ${toSymbol}`);
  } else if (comparison.all.length === 1) {
    lines.push(`\nOnly one aggregator returned a quote — using ${sourceLabel(comparison.best.source)}.`);
  }

  return lines.join("\n");
}
