import { OkxCredentials, SwapQuote, SwapRequest, RouteComparison } from "./types";
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

  // Query both sources in parallel
  const [okxQuote, uniQuote] = await Promise.all([
    onchainos.getQuote(okxCreds, fromToken, toToken, amount),
    uniswap.getQuote(fromToken, toToken, amount, walletAddress),
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

  for (const quote of comparison.all) {
    const tag = quote === comparison.best ? " ** BEST **" : "";
    lines.push(`[${quote.source.toUpperCase()}]${tag}`);
    lines.push(`  Output amount: ${quote.toAmount}`);
    lines.push(`  Estimated gas: ${quote.estimatedGas}`);
    lines.push(`  Price impact:  ${quote.priceImpact}%`);
    lines.push(`  Route:         ${quote.routePath.join(" -> ")}`);
    lines.push("");
  }

  if (comparison.all.length > 1) {
    lines.push(`Savings with best route: ${comparison.savings} (smallest units)`);
  } else {
    lines.push("Only one source returned a quote.");
  }

  return lines.join("\n");
}
