import { TOKENS } from "./types";

export interface SwapIntent {
  fromToken: string;
  toToken: string;
  amount: string;
  amountType: "exact" | "percentage" | "all";
  condition?: SwapCondition;
}

export interface SwapCondition {
  type: "price_below" | "price_above";
  targetPrice: number;
  tokenAddress: string;
}

export interface PlanResult {
  intent: SwapIntent;
  warnings: string[];
  summary: string;
}

// Token aliases — maps natural language names to symbols
const TOKEN_ALIASES: Record<string, string> = {
  okb: "OKB",
  wokb: "WOKB",
  "wrapped okb": "WOKB",
  usdt: "USDT",
  tether: "USDT",
  usdc: "USDC",
  "usd coin": "USDC",
  weth: "WETH",
  eth: "WETH",
  ether: "WETH",
  ethereum: "WETH",
};

const TOKEN_ADDRESSES: Record<string, string> = {
  OKB: TOKENS.NATIVE_OKB,
  WOKB: TOKENS.WOKB,
  USDT: TOKENS.USDT,
  USDC: TOKENS.USDC,
  WETH: TOKENS.WETH,
};

/**
 * Parse a natural language swap command into a structured intent.
 *
 * Supported patterns:
 *   "swap 100 USDT for OKB"
 *   "convert half my USDT to OKB"
 *   "sell all WETH for USDC"
 *   "buy OKB with 50 USDT"
 *   "swap 100 USDT to OKB if price is below 50"
 */
export function parseSwapIntent(input: string): PlanResult {
  const lower = input.toLowerCase().trim();
  const warnings: string[] = [];

  // Try to extract tokens
  let fromToken: string | null = null;
  let toToken: string | null = null;
  let amount: string = "0";
  let amountType: "exact" | "percentage" | "all" = "exact";
  let condition: SwapCondition | undefined;

  // Pattern: "swap/convert/sell X TOKEN for/to TOKEN"
  const swapPattern = /(?:swap|convert|exchange|sell|trade)\s+(\S+)\s+(\S+)\s+(?:for|to|into)\s+(\S+)/i;
  const swapMatch = lower.match(swapPattern);

  // Pattern: "buy TOKEN with X TOKEN"
  const buyPattern = /(?:buy|purchase|get)\s+(\S+)\s+(?:with|using)\s+(\S+)\s+(\S+)/i;
  const buyMatch = lower.match(buyPattern);

  // Pattern: "swap all/half TOKEN to TOKEN"
  const portionPattern = /(?:swap|convert|sell)\s+(all|half|quarter)\s+(?:my\s+)?(\S+)\s+(?:for|to|into)\s+(\S+)/i;
  const portionMatch = lower.match(portionPattern);

  if (portionMatch) {
    const [, portion, from, to] = portionMatch;
    fromToken = resolveTokenName(from);
    toToken = resolveTokenName(to);

    if (portion === "all") {
      amountType = "all";
      amount = "all";
    } else if (portion === "half") {
      amountType = "percentage";
      amount = "50";
    } else if (portion === "quarter") {
      amountType = "percentage";
      amount = "25";
    }
  } else if (swapMatch) {
    const [, rawAmount, from, to] = swapMatch;
    fromToken = resolveTokenName(from);
    toToken = resolveTokenName(to);
    amount = rawAmount;
    amountType = "exact";
  } else if (buyMatch) {
    const [, to, rawAmount, from] = buyMatch;
    fromToken = resolveTokenName(from);
    toToken = resolveTokenName(to);
    amount = rawAmount;
    amountType = "exact";
  }

  // Check for price conditions
  const conditionPattern = /(?:if|when)\s+(?:the\s+)?price\s+(?:is\s+)?(?:below|under|less than)\s+(\d+\.?\d*)/i;
  const condAbovePattern = /(?:if|when)\s+(?:the\s+)?price\s+(?:is\s+)?(?:above|over|more than|greater than)\s+(\d+\.?\d*)/i;
  const condMatch = lower.match(conditionPattern);
  const condAboveMatch = lower.match(condAbovePattern);

  if (condMatch && toToken) {
    condition = {
      type: "price_below",
      targetPrice: parseFloat(condMatch[1]),
      tokenAddress: TOKEN_ADDRESSES[toToken] || toToken,
    };
  } else if (condAboveMatch && toToken) {
    condition = {
      type: "price_above",
      targetPrice: parseFloat(condAboveMatch[1]),
      tokenAddress: TOKEN_ADDRESSES[toToken] || toToken,
    };
  }

  // Validation
  if (!fromToken) {
    warnings.push("Could not identify source token. Please specify (e.g., USDT, OKB, WETH).");
  }
  if (!toToken) {
    warnings.push("Could not identify destination token. Please specify (e.g., USDT, OKB, WETH).");
  }
  if (amountType === "exact" && (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)) {
    warnings.push(`Could not parse amount "${amount}". Please use a number (e.g., 100, 0.5).`);
  }

  // Resolve to addresses
  const fromAddr = fromToken ? (TOKEN_ADDRESSES[fromToken] || fromToken) : "";
  const toAddr = toToken ? (TOKEN_ADDRESSES[toToken] || toToken) : "";

  const intent: SwapIntent = {
    fromToken: fromAddr,
    toToken: toAddr,
    amount,
    amountType,
    condition,
  };

  // Build summary
  let summary = "";
  if (fromToken && toToken) {
    if (amountType === "all") {
      summary = `Swap all ${fromToken} for ${toToken}`;
    } else if (amountType === "percentage") {
      summary = `Swap ${amount}% of ${fromToken} for ${toToken}`;
    } else {
      summary = `Swap ${amount} ${fromToken} for ${toToken}`;
    }
    if (condition) {
      summary += ` (${condition.type === "price_below" ? "if price below" : "if price above"} $${condition.targetPrice})`;
    }
  } else {
    summary = "Could not parse swap intent — see warnings";
  }

  return { intent, warnings, summary };
}

function resolveTokenName(input: string): string | null {
  const lower = input.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (TOKEN_ALIASES[lower]) return TOKEN_ALIASES[lower];
  // Check if it's already a known symbol
  const upper = input.toUpperCase();
  if (TOKEN_ADDRESSES[upper]) return upper;
  // Check if it looks like an address
  if (input.startsWith("0x") && input.length === 42) return input;
  return null;
}

/**
 * Generate a pre-swap analysis with risks and recommendations.
 */
export function generateSwapAdvice(
  fromSymbol: string,
  toSymbol: string,
  amountUsd: number,
  liquidityUsd: number,
  priceChange24h: number,
  volatility: number
): string[] {
  const advice: string[] = [];

  // Large trade warning
  if (liquidityUsd > 0 && amountUsd / liquidityUsd > 0.05) {
    advice.push(
      `WARNING: This trade is ${((amountUsd / liquidityUsd) * 100).toFixed(1)}% of available liquidity. ` +
      `Consider splitting into smaller swaps to reduce price impact.`
    );
  }

  // Volatility warning
  if (volatility > 5) {
    advice.push(
      `CAUTION: ${toSymbol} has high recent volatility (${volatility.toFixed(1)}%). ` +
      `Price may move significantly before your swap executes.`
    );
  }

  // Momentum warning — buying into a dump or selling into a pump
  if (priceChange24h < -10) {
    advice.push(
      `NOTE: ${toSymbol} is down ${Math.abs(priceChange24h).toFixed(1)}% in 24h. ` +
      `You may be catching a falling knife — or getting a discount.`
    );
  } else if (priceChange24h > 10) {
    advice.push(
      `NOTE: ${toSymbol} is up ${priceChange24h.toFixed(1)}% in 24h. ` +
      `Consider whether the pump has room to run or is overextended.`
    );
  }

  // Stablecoin swap — low risk
  const stables = ["USDT", "USDC"];
  if (stables.includes(fromSymbol) && stables.includes(toSymbol)) {
    advice.push("This is a stablecoin-to-stablecoin swap — low risk, minimal slippage expected.");
  }

  if (advice.length === 0) {
    advice.push("Market conditions look normal for this swap. Proceed when ready.");
  }

  return advice;
}
