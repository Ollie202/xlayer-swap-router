import { TOKENS } from "./types";

export interface SwapIntent {
  fromToken: string;
  toToken: string;
  amount: string;
  /**
   * - exact:      a specific token amount (e.g. "100" USDT)
   * - percentage: a percent of the wallet's from-token balance
   * - all:        entire from-token balance
   * - dollar:     a USD value — converted to tokens at live price at run time
   */
  amountType: "exact" | "percentage" | "all" | "dollar";
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

// Token aliases — natural language names + common misspellings
const TOKEN_ALIASES: Record<string, string> = {
  okb: "OKB",
  wokb: "WOKB",
  "wrapped okb": "WOKB",
  "wrappedokb": "WOKB",
  usdt: "USDT",
  tether: "USDT",
  usdc: "USDC",
  "usd coin": "USDC",
  "usdcoin": "USDC",
  usdd: "USDD",
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
  // USDD is not currently deployed on X Layer. We keep the symbol here so
  // the parser returns a helpful error instead of a cryptic one — execution
  // will fail fast with a message pointing at USDT/USDC.
};

// Words meaning "all of my balance"
const ALL_WORDS = new Set([
  "all", "everything", "max", "full", "entire", "whole", "100%",
]);

// Fractional words → percentage
const FRACTION_WORDS: Record<string, number> = {
  half: 50,
  "a half": 50,
  quarter: 25,
  "a quarter": 25,
  third: 33,
  "a third": 33,
  tenth: 10,
  "a tenth": 10,
  fifth: 20,
  "a fifth": 20,
  "two thirds": 66,
  "three quarters": 75,
};

// Verbs that introduce a swap
const SWAP_VERBS = [
  "swap", "convert", "exchange", "trade", "sell", "change", "flip",
  "dump", "yeet", "move", "ape", "turn", "switch", "send",
];

/**
 * Parse a natural language swap command into a structured intent.
 *
 * Supported phrasings (non-exhaustive — parser is forgiving):
 *
 * Basic:
 *   "swap 100 USDT for OKB"
 *   "swap 100 USDT to OKB"
 *   "convert 0.5 OKB to USDT"
 *   "sell 50 USDT for WETH"
 *   "trade 10 USDT for USDC"
 *   "exchange 5 OKB for USDT"
 *   "100 USDT to OKB"
 *   "100 USDT for OKB"
 *
 * Slangy:
 *   "flip 5 OKB to USDT"
 *   "dump all my USDT into OKB"
 *   "yeet 100 USDT into OKB"
 *   "move 20 USDT to OKB"
 *   "turn 50 USDT into OKB"
 *   "change 100 USDT to USDC"
 *   "ape 10 USDT into OKB"
 *
 * Percentages / portions:
 *   "swap half my USDT to OKB"
 *   "swap all my WETH for USDT"
 *   "swap my entire USDT balance to OKB"
 *   "convert 25% of my OKB to USDT"
 *   "swap 10% of my USDT for OKB"
 *   "a quarter of my USDT to OKB"
 *   "a tenth of my OKB for USDT"
 *   "two thirds of my OKB for USDT"
 *
 * Dollar-value:
 *   "swap $5 worth of OKB to USDT"
 *   "swap $100 of USDT to OKB"
 *   "$20 of OKB to USDT"
 *
 * Conditions:
 *   "swap 100 USDT for OKB if price is below 50"
 *   "swap 100 USDT to OKB when price is above 60"
 *   "swap 50 USDT to OKB if OKB is below $45"
 *   "swap 100 USDT for OKB once price drops to 40"
 *   "swap 50 USDT for OKB if OKB price over $50"
 *   "swap 1 USDT to OKB if price above $55"
 *
 * Buy/purchase:
 *   "buy OKB with 100 USDT"
 *   "purchase OKB using 50 USDT"
 *   "get me OKB with 20 USDT"
 */
export function parseSwapIntent(input: string): PlanResult {
  const warnings: string[] = [];
  let lower = input.toLowerCase().trim();

  // Normalize: collapse multi-spaces, strip most punctuation except $ % .
  lower = lower.replace(/[,;!?]/g, " ").replace(/\s+/g, " ").trim();

  // --- Extract and strip price condition first (so it doesn't leak into token parsing) ---
  let condition: SwapCondition | undefined;
  const { stripped: condStripped, condition: condOut } = extractCondition(lower);
  lower = condStripped;

  let fromToken: string | null = null;
  let toToken: string | null = null;
  let amount: string = "0";
  type AmountType = "exact" | "percentage" | "all" | "dollar";
  let amountType: AmountType = "exact" as AmountType;

  // Build regex alternation of swap verbs (optional leading verb)
  const verbAlt = `(?:${SWAP_VERBS.join("|")})`;

  const patterns: Array<{ re: RegExp; handler: (m: RegExpMatchArray) => void }> = [
    // "swap $5 worth of OKB to USDT", "$20 of OKB to USDT"
    {
      re: new RegExp(`(?:${verbAlt}\\s+)?\\$?\\s*([\\d.]+)\\s*(?:dollars?|usd|bucks)?\\s*(?:worth\\s+)?of\\s+(\\S+)\\s+(?:to|for|into)\\s+(\\S+)`, "i"),
      handler: (m) => {
        amount = m[1];
        amountType = "dollar";
        fromToken = resolveTokenName(m[2]);
        toToken = resolveTokenName(m[3]);
      },
    },
    // "$5 OKB -> USDT" (dollar-sign prefix with no "worth of")
    {
      re: new RegExp(`(?:${verbAlt}\\s+)?\\$\\s*([\\d.]+)\\s+(?:of\\s+|in\\s+)?(\\S+)\\s+(?:to|for|into)\\s+(\\S+)`, "i"),
      handler: (m) => {
        amount = m[1];
        amountType = "dollar";
        fromToken = resolveTokenName(m[2]);
        toToken = resolveTokenName(m[3]);
      },
    },
    // "swap 10% of my USDT to OKB"
    {
      re: new RegExp(`(?:${verbAlt}\\s+)?([\\d.]+)\\s*%\\s+of\\s+(?:my\\s+|the\\s+)?(\\S+?)(?:\\s+balance)?\\s+(?:to|for|into)\\s+(\\S+)`, "i"),
      handler: (m) => {
        amount = m[1];
        amountType = "percentage";
        fromToken = resolveTokenName(m[2]);
        toToken = resolveTokenName(m[3]);
      },
    },
    // "swap all/half/quarter/third/tenth my USDT to OKB"
    // Also "swap my entire USDT balance to OKB"
    {
      re: new RegExp(`(?:${verbAlt}\\s+)?(?:my\\s+)?(all|half|quarter|third|tenth|fifth|entire|whole|everything|max|full|a\\s+half|a\\s+quarter|a\\s+third|a\\s+tenth|a\\s+fifth|two\\s+thirds|three\\s+quarters)\\s+(?:of\\s+)?(?:my\\s+|the\\s+)?(\\S+?)(?:\\s+balance|\\s+stack|\\s+bag|\\s+holdings?)?\\s+(?:to|for|into)\\s+(\\S+)`, "i"),
      handler: (m) => {
        const word = m[1].toLowerCase();
        fromToken = resolveTokenName(m[2]);
        toToken = resolveTokenName(m[3]);
        if (ALL_WORDS.has(word) || ["entire", "whole"].includes(word)) {
          amountType = "all";
          amount = "all";
        } else if (FRACTION_WORDS[word] !== undefined) {
          amountType = "percentage";
          amount = String(FRACTION_WORDS[word]);
        } else {
          amountType = "all";
          amount = "all";
        }
      },
    },
    // "buy OKB with 100 USDT", "get me OKB with 20 USDT"
    {
      re: new RegExp(`(?:buy|purchase|get(?:\\s+me)?|grab)\\s+(?:me\\s+)?(?:some\\s+)?(\\S+)\\s+(?:with|using|for)\\s+([\\d.]+)\\s+(\\S+)`, "i"),
      handler: (m) => {
        toToken = resolveTokenName(m[1]);
        amount = m[2];
        fromToken = resolveTokenName(m[3]);
        amountType = "exact";
      },
    },
    // "swap 100 USDT for OKB" / "swap 0.5 OKB to USDT" / "swap 10 USDT USDC"
    {
      re: new RegExp(`(?:${verbAlt}\\s+)?([\\d.]+)\\s+(\\S+)\\s+(?:to|for|into|->|=>)\\s+(\\S+)`, "i"),
      handler: (m) => {
        amount = m[1];
        fromToken = resolveTokenName(m[2]);
        toToken = resolveTokenName(m[3]);
        amountType = "exact";
      },
    },
    // "swap 10 USDT OKB" (no connector)
    {
      re: new RegExp(`${verbAlt}\\s+([\\d.]+)\\s+(\\S+)\\s+(\\S+)`, "i"),
      handler: (m) => {
        amount = m[1];
        fromToken = resolveTokenName(m[2]);
        toToken = resolveTokenName(m[3]);
        amountType = "exact";
      },
    },
  ];

  for (const p of patterns) {
    const m = lower.match(p.re);
    if (m) {
      p.handler(m);
      if (fromToken && toToken) break;
      // partial match — reset and keep trying
      fromToken = null;
      toToken = null;
    }
  }

  // Re-attach condition
  if (condOut && toToken) {
    condition = {
      type: condOut.type,
      targetPrice: condOut.targetPrice,
      tokenAddress: TOKEN_ADDRESSES[toToken] || toToken,
    };
  }

  // --- Validation ---
  if (!fromToken) {
    warnings.push("Could not identify source token. Try e.g. 'swap 10 USDT for OKB'.");
  } else if (fromToken === "USDD") {
    warnings.push("USDD is not currently available on X Layer. Did you mean USDT or USDC?");
  }
  if (!toToken) {
    warnings.push("Could not identify destination token. Try e.g. 'swap 10 USDT for OKB'.");
  } else if (toToken === "USDD") {
    warnings.push("USDD is not currently available on X Layer. Did you mean USDT or USDC?");
  }
  if (fromToken && toToken && fromToken === toToken) {
    warnings.push(`Source and destination tokens are the same (${fromToken}). No swap to perform.`);
  }
  if ((amountType === "exact" || amountType === "dollar") &&
      (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)) {
    warnings.push(`Could not parse amount "${amount}". Please use a number (e.g., 100, 0.5).`);
  }

  // Resolve to addresses (fall through to raw input if it's already an address)
  const fromAddr = fromToken ? (TOKEN_ADDRESSES[fromToken] || fromToken) : "";
  const toAddr = toToken ? (TOKEN_ADDRESSES[toToken] || toToken) : "";

  const intent: SwapIntent = {
    fromToken: fromAddr,
    toToken: toAddr,
    amount,
    amountType,
    condition,
  };

  // --- Build human-readable summary ---
  let summary = "";
  if (fromToken && toToken) {
    if (amountType === "all") {
      summary = `Swap all ${fromToken} for ${toToken}`;
    } else if (amountType === "percentage") {
      summary = `Swap ${amount}% of ${fromToken} for ${toToken}`;
    } else if (amountType === "dollar") {
      summary = `Swap $${amount} worth of ${fromToken} for ${toToken}`;
    } else {
      summary = `Swap ${amount} ${fromToken} for ${toToken}`;
    }
    if (condition) {
      summary += ` (if ${toToken} price ${condition.type === "price_below" ? "below" : "above"} $${condition.targetPrice})`;
    }
  } else {
    summary = "Could not parse swap intent — see warnings";
  }

  return { intent, warnings, summary };
}

function extractCondition(text: string): {
  stripped: string;
  condition?: { type: "price_below" | "price_above"; targetPrice: number };
} {
  // Conditions with various phrasings:
  //   "if/when/once [TOKEN] [is/price/its price] (below|under|less than) 50"
  //   "if price drops to 40" / "if price rises to 60" / "at $50"
  const belowWords = "below|under|less\\s+than|beneath|drops?\\s+to|reaches?\\s+below|less|<=?";
  const aboveWords = "above|over|more\\s+than|greater\\s+than|exceeds?|rises?\\s+to|reaches?|hits?|>=?";

  const belowRe = new RegExp(
    `\\s+(?:if|when|once|after|provided)\\s+(?:the\\s+)?(?:\\S+\\s+)?(?:price\\s+)?(?:is\\s+)?(?:${belowWords})\\s+\\$?([\\d.]+)`,
    "i"
  );
  const aboveRe = new RegExp(
    `\\s+(?:if|when|once|after|provided)\\s+(?:the\\s+)?(?:\\S+\\s+)?(?:price\\s+)?(?:is\\s+)?(?:${aboveWords})\\s+\\$?([\\d.]+)`,
    "i"
  );
  // "at $50" / "at 50 dollars" — ambiguous, treat as "<=" (below)
  const atRe = /\s+at\s+\$?([\d.]+)(?:\s+dollars?|\s+bucks|\s+usd)?$/i;

  const mBelow = text.match(belowRe);
  const mAbove = text.match(aboveRe);

  if (mBelow && (!mAbove || (mBelow.index ?? 0) < (mAbove.index ?? Infinity))) {
    return {
      stripped: text.replace(belowRe, "").trim(),
      condition: { type: "price_below", targetPrice: parseFloat(mBelow[1]) },
    };
  }
  if (mAbove) {
    return {
      stripped: text.replace(aboveRe, "").trim(),
      condition: { type: "price_above", targetPrice: parseFloat(mAbove[1]) },
    };
  }
  const mAt = text.match(atRe);
  if (mAt) {
    return {
      stripped: text.replace(atRe, "").trim(),
      condition: { type: "price_below", targetPrice: parseFloat(mAt[1]) },
    };
  }
  return { stripped: text };
}

function resolveTokenName(input: string): string | null {
  if (!input) return null;
  // Strip trailing punctuation and normalize
  const cleaned = input.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (TOKEN_ALIASES[cleaned]) return TOKEN_ALIASES[cleaned];
  // Check if it's already a known symbol
  const upper = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (TOKEN_ADDRESSES[upper]) return upper;
  if (upper === "USDD") return "USDD"; // parser recognizes symbol even though we error at validation
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

  if (liquidityUsd > 0 && amountUsd / liquidityUsd > 0.05) {
    advice.push(
      `WARNING: This trade is ${((amountUsd / liquidityUsd) * 100).toFixed(1)}% of available liquidity. ` +
      `Consider splitting into smaller swaps to reduce price impact.`
    );
  }

  if (volatility > 5) {
    advice.push(
      `CAUTION: ${toSymbol} has high recent volatility (${volatility.toFixed(1)}%). ` +
      `Price may move significantly before your swap executes.`
    );
  }

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

  const stables = ["USDT", "USDC"];
  if (stables.includes(fromSymbol) && stables.includes(toSymbol)) {
    advice.push("This is a stablecoin-to-stablecoin swap — low risk, minimal slippage expected.");
  }

  if (advice.length === 0) {
    advice.push("Market conditions look normal for this swap. Proceed when ready.");
  }

  return advice;
}
