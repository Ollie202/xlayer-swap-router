import { OkxCredentials, SwapQuote, TOKENS, XLAYER_CHAIN_ID, fromMinimalUnits } from "./types";
import * as onchainos from "./onchainos";

// Common intermediate tokens for multi-hop routing on X Layer
const HOP_TOKENS = [
  { symbol: "WOKB", address: TOKENS.WOKB },
  { symbol: "USDT", address: TOKENS.USDT },
  { symbol: "USDC", address: TOKENS.USDC },
  { symbol: "WETH", address: TOKENS.WETH },
];

export interface MultiHopRoute {
  path: string[];           // Token addresses in order
  pathSymbols: string[];    // Token symbols for display
  totalOutput: string;      // Final output amount
  quotes: SwapQuote[];      // Individual leg quotes
  estimatedTotalGas: string;
}

/**
 * Find the best multi-hop route by trying all possible intermediate tokens.
 * Compares A->B direct with A->X->B for each intermediate X.
 */
export async function findMultiHopRoutes(
  creds: OkxCredentials,
  fromToken: string,
  toToken: string,
  amount: string
): Promise<MultiHopRoute[]> {
  const routes: MultiHopRoute[] = [];

  // Filter out intermediaries that are the same as from or to
  const intermediaries = HOP_TOKENS.filter(
    (t) =>
      t.address.toLowerCase() !== fromToken.toLowerCase() &&
      t.address.toLowerCase() !== toToken.toLowerCase()
  );

  // Query all first-leg quotes in parallel
  const firstLegPromises = intermediaries.map((mid) =>
    onchainos.getQuote(creds, fromToken, mid.address, amount).then((quote) => ({
      mid,
      quote,
    }))
  );

  const firstLegs = await Promise.all(firstLegPromises);

  // For each successful first leg, query the second leg
  const secondLegPromises = firstLegs
    .filter((fl) => fl.quote !== null)
    .map(async ({ mid, quote }) => {
      const secondQuote = await onchainos.getQuote(
        creds,
        mid.address,
        toToken,
        quote!.toAmount // Output of first leg becomes input of second
      );

      if (!secondQuote) return null;

      const totalGas =
        BigInt(quote!.estimatedGas || "0") +
        BigInt(secondQuote.estimatedGas || "0");

      const fromSymbol = resolveSymbol(fromToken);
      const toSymbol = resolveSymbol(toToken);

      return {
        path: [fromToken, mid.address, toToken],
        pathSymbols: [fromSymbol, mid.symbol, toSymbol],
        totalOutput: secondQuote.toAmount,
        quotes: [quote!, secondQuote],
        estimatedTotalGas: totalGas.toString(),
      } as MultiHopRoute;
    });

  const results = await Promise.all(secondLegPromises);
  for (const r of results) {
    if (r) routes.push(r);
  }

  // Sort by output amount (highest first)
  routes.sort((a, b) => {
    const amtA = BigInt(a.totalOutput);
    const amtB = BigInt(b.totalOutput);
    if (amtA > amtB) return -1;
    if (amtA < amtB) return 1;
    return 0;
  });

  return routes;
}

function resolveSymbol(address: string): string {
  const lower = address.toLowerCase();
  for (const [key, val] of Object.entries(TOKENS)) {
    if (val.toLowerCase() === lower) return key;
  }
  return address.slice(0, 8) + "...";
}

/**
 * Format multi-hop routes for display.
 */
export function formatMultiHopRoutes(
  routes: MultiHopRoute[],
  directQuote: SwapQuote | null
): string {
  const lines: string[] = [];
  lines.push("=== Multi-Hop Route Analysis ===\n");

  const toToken = directQuote?.toToken || routes[0]?.path[routes[0].path.length - 1];
  const toSymbol = toToken ? resolveSymbol(toToken) : "";
  const fmtOut = (raw: string) => toToken ? `${fromMinimalUnits(raw, toToken)} ${toSymbol}` : raw;
  const fmtGas = (g: string) => g && g !== "0" ? `~${Number(g).toLocaleString("en-US")} units` : "-";

  if (directQuote) {
    lines.push(`[DIRECT] ${resolveSymbol(directQuote.fromToken)} -> ${resolveSymbol(directQuote.toToken)}`);
    lines.push(`  Output: ${fmtOut(directQuote.toAmount)}`);
    lines.push(`  Gas:    ${fmtGas(directQuote.estimatedGas)}`);
    lines.push("");
  }

  if (routes.length === 0) {
    lines.push("No multi-hop routes found.");
    return lines.join("\n");
  }

  for (let i = 0; i < Math.min(routes.length, 3); i++) {
    const r = routes[i];
    const isBest =
      directQuote && BigInt(r.totalOutput) > BigInt(directQuote.toAmount);
    const tag = i === 0 && isBest ? " ** BETTER THAN DIRECT **" : "";

    lines.push(`[HOP ${i + 1}] ${r.pathSymbols.join(" -> ")}${tag}`);
    lines.push(`  Output: ${fmtOut(r.totalOutput)}`);
    lines.push(`  Gas:    ${fmtGas(r.estimatedTotalGas)}`);
    lines.push(`  Path:   ${r.pathSymbols.join(" -> ")}`);
    lines.push("");
  }

  // Compare best hop vs direct (in human-readable output units)
  if (directQuote && routes.length > 0) {
    const directAmt = BigInt(directQuote.toAmount);
    const hopAmt = BigInt(routes[0].totalOutput);
    if (hopAmt > directAmt) {
      const diff = (hopAmt - directAmt).toString();
      lines.push(
        `Best multi-hop route gives ${fmtOut(diff)} more output than direct swap!`
      );
    } else {
      const diff = (directAmt - hopAmt).toString();
      lines.push(
        `Direct swap is better by ${fmtOut(diff)} — no need for multi-hop.`
      );
    }
  }

  return lines.join("\n");
}
