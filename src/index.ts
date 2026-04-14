import {
  OkxCredentials,
  SwapRequest,
  SwapResult,
  TOKENS,
  toMinimalUnits,
} from "./types";
import { findBestRoute, formatComparison } from "./router";
import * as onchainos from "./onchainos";
import * as uniswap from "./uniswap";
import * as market from "./market";
import * as portfolioMod from "./portfolio";
import * as multihop from "./multihop";
import { createWallet, ensureApproval, executeSwap, getWalletInfo } from "./wallet";
import { calculateSmartSlippage, formatSlippageRecommendation } from "./smartSlippage";
import { parseSwapIntent, generateSwapAdvice } from "./planner";

// Re-export everything
export { findBestRoute, formatComparison } from "./router";
export * as onchainos from "./onchainos";
export * as uniswap from "./uniswap";
export * as market from "./market";
export * as portfolio from "./portfolio";
export * as multihop from "./multihop";
export * from "./wallet";
export * from "./types";
export * from "./smartSlippage";
export * from "./planner";

const SYMBOL_MAP: Record<string, string> = {
  OKB: TOKENS.NATIVE_OKB,
  WOKB: TOKENS.WOKB,
  USDT: TOKENS.USDT,
  USDC: TOKENS.USDC,
  WETH: TOKENS.WETH,
  ETH: TOKENS.WETH,
};

function resolveToken(token: string): string {
  if (token.startsWith("0x") || token.startsWith("0X")) return token;
  const addr = SYMBOL_MAP[token.toUpperCase()];
  if (!addr) throw new Error(`Unknown token symbol: ${token}. Use a contract address instead.`);
  return addr;
}

function resolveSymbol(address: string): string {
  const lower = address.toLowerCase();
  for (const [k, v] of Object.entries(SYMBOL_MAP)) {
    if (v.toLowerCase() === lower) return k;
  }
  return address.slice(0, 8) + "...";
}

/**
 * Compare routes and return the best quote (read-only).
 */
export async function quote(
  fromToken: string,
  toToken: string,
  amount: string,
  walletAddress: string,
  okxCreds: OkxCredentials
) {
  const fromAddr = resolveToken(fromToken);
  const toAddr = resolveToken(toToken);

  const request: SwapRequest = {
    fromToken: fromAddr,
    toToken: toAddr,
    amount,
    walletAddress,
  };

  const comparison = await findBestRoute(request, okxCreds);
  return { comparison, summary: formatComparison(comparison) };
}

/**
 * Full intelligent analysis: market data, portfolio check, smart slippage,
 * multi-hop routes, and AI-generated advice. Does NOT execute.
 */
export async function analyze(
  fromToken: string,
  toToken: string,
  amount: string,
  walletAddress: string,
  okxCreds: OkxCredentials
) {
  const fromAddr = resolveToken(fromToken);
  const toAddr = resolveToken(toToken);
  const fromSymbol = resolveSymbol(fromAddr);
  const toSymbol = resolveSymbol(toAddr);

  const sections: string[] = [];
  sections.push(`\n========================================`);
  sections.push(`  SWAP ANALYSIS: ${fromSymbol} -> ${toSymbol}`);
  sections.push(`========================================\n`);

  // Parallel fetches
  const [comparison, tradingInfo, candles, portfolio, multiHopRoutes] = await Promise.all([
    findBestRoute({ fromToken: fromAddr, toToken: toAddr, amount, walletAddress }, okxCreds).catch(() => null),
    market.getTradingInfo(okxCreds, toAddr),
    market.getCandlesticks(okxCreds, toAddr, "1H", 24),
    portfolioMod.getPortfolio(okxCreds, walletAddress),
    multihop.findMultiHopRoutes(okxCreds, fromAddr, toAddr, amount),
  ]);

  // 1. Portfolio
  sections.push(portfolioMod.formatPortfolio(portfolio));

  // 2. Market analysis on destination token
  if (tradingInfo) {
    sections.push("\n" + market.formatMarketAnalysis(toSymbol, tradingInfo, candles));
  }

  // 3. Route comparison (direct)
  if (comparison) {
    sections.push("\n" + formatComparison(comparison));
  }

  // 4. Multi-hop comparison
  if (multiHopRoutes.length > 0) {
    sections.push("\n" + multihop.formatMultiHopRoutes(multiHopRoutes, comparison?.best || null));
  }

  // 5. Smart slippage recommendation
  const tradeAmountUsd = tradingInfo
    ? (parseFloat(amount) * parseFloat(tradingInfo.price)) / 1e18
    : parseFloat(amount) / 1e6;
  const slippageRec = calculateSmartSlippage(tradeAmountUsd, tradingInfo, candles);
  sections.push("\n" + formatSlippageRecommendation(slippageRec));

  // 6. Risk assessment
  const riskWarnings = portfolioMod.assessSwapRisk(portfolio, fromAddr, tradeAmountUsd);
  sections.push("\n=== Risk Assessment ===");
  riskWarnings.forEach((w) => sections.push(`  - ${w}`));

  // 7. AI advice
  if (tradingInfo) {
    const volatility = candles.length >= 2
      ? parseFloat(market.formatMarketAnalysis(toSymbol, tradingInfo, candles).match(/Volatility.*?([\d.]+)%/)?.[1] || "0")
      : 0;
    const advice = generateSwapAdvice(
      fromSymbol, toSymbol, tradeAmountUsd,
      parseFloat(tradingInfo.liquidity),
      parseFloat(tradingInfo.priceChange24H),
      volatility
    );
    sections.push("\n=== AI Advice ===");
    advice.forEach((a) => sections.push(`  - ${a}`));
  }

  return {
    summary: sections.join("\n"),
    comparison,
    tradingInfo,
    portfolio,
    multiHopRoutes,
    slippage: slippageRec,
    riskWarnings,
  };
}

/**
 * Execute swap via best route with smart slippage.
 */
export async function swapViaBestRoute(
  fromToken: string,
  toToken: string,
  amount: string,
  privateKey: string,
  okxCreds: OkxCredentials,
  slippagePercent?: number
): Promise<SwapResult> {
  const fromAddr = resolveToken(fromToken);
  const toAddr = resolveToken(toToken);

  const wallet = createWallet(privateKey);
  const walletInfo = await getWalletInfo(wallet);
  console.log(`Wallet: ${walletInfo.address} (${walletInfo.balanceOKB} OKB)\n`);

  // Auto-calculate slippage if not provided
  if (slippagePercent === undefined) {
    console.log("Calculating smart slippage...");
    const [tradingInfo, candles] = await Promise.all([
      market.getTradingInfo(okxCreds, toAddr),
      market.getCandlesticks(okxCreds, toAddr, "1H", 24),
    ]);
    const tradeAmountUsd = tradingInfo
      ? (parseFloat(amount) * parseFloat(tradingInfo.price)) / 1e18
      : parseFloat(amount) / 1e6;
    const rec = calculateSmartSlippage(tradeAmountUsd, tradingInfo, candles);
    console.log(formatSlippageRecommendation(rec) + "\n");
    slippagePercent = rec.slippagePercent;
  }

  const comparison = await findBestRoute(
    { fromToken: fromAddr, toToken: toAddr, amount, walletAddress: wallet.address, slippagePercent },
    okxCreds
  );
  console.log(formatComparison(comparison));

  const best = comparison.best;
  await ensureApproval(wallet, fromAddr, amount, okxCreds);

  if (best.source === "onchainos") {
    const swapData = await onchainos.getSwapTx(
      okxCreds, fromAddr, toAddr, amount, wallet.address, slippagePercent
    );
    if (!swapData) {
      return { success: false, source: "onchainos", fromToken: fromAddr, toToken: toAddr, fromAmount: amount, toAmount: "0", error: "Failed to build swap transaction" };
    }
    const result = await executeSwap(wallet, {
      to: swapData.tx.to, data: swapData.tx.data, value: swapData.tx.value, gasLimit: swapData.tx.gasLimit,
    });
    return { success: true, source: "onchainos", txHash: result.txHash, fromToken: fromAddr, toToken: toAddr, fromAmount: amount, toAmount: best.toAmount };
  } else {
    const swapData = await uniswap.getSwapTx(fromAddr, toAddr, amount, wallet.address, slippagePercent / 100);
    if (!swapData) {
      return { success: false, source: "uniswap", fromToken: fromAddr, toToken: toAddr, fromAmount: amount, toAmount: "0", error: "Failed to build swap transaction" };
    }
    const result = await executeSwap(wallet, {
      to: swapData.swap.to, data: swapData.swap.data, value: swapData.swap.value, gasLimit: swapData.swap.gasLimit,
    });
    return { success: true, source: "uniswap", txHash: result.txHash, fromToken: fromAddr, toToken: toAddr, fromAmount: amount, toAmount: best.toAmount };
  }
}

/**
 * Parse a natural language swap command and execute it.
 */
export async function swapFromNaturalLanguage(
  input: string,
  privateKey: string,
  okxCreds: OkxCredentials
): Promise<SwapResult | { error: string; warnings: string[] }> {
  const { intent, warnings, summary } = parseSwapIntent(input);
  console.log(`Understood: ${summary}\n`);

  if (warnings.length > 0) {
    return { error: "Could not parse swap intent", warnings };
  }

  // Handle percentage/all — need portfolio to compute actual amount
  let amount = intent.amount;
  if (intent.amountType === "exact") {
    // Convert human-readable amount (e.g. "0.5") to minimal units (e.g. "500000")
    amount = toMinimalUnits(intent.amount, intent.fromToken);
  } else {
    const wallet = createWallet(privateKey);
    const portfolio = await portfolioMod.getPortfolio(okxCreds, wallet.address);
    const token = portfolio.tokens.find(
      (t) => t.tokenAddress.toLowerCase() === intent.fromToken.toLowerCase()
    );
    if (!token) {
      return { error: `Token not found in wallet: ${intent.fromToken}`, warnings: [] };
    }
    const fullBalance = BigInt(token.balance);
    if (intent.amountType === "all") {
      amount = fullBalance.toString();
    } else {
      const pct = parseFloat(intent.amount);
      amount = ((fullBalance * BigInt(Math.floor(pct))) / BigInt(100)).toString();
    }
    console.log(`Resolved amount: ${amount} (${intent.amountType} of ${token.symbol} balance)\n`);
  }

  // Check price condition
  if (intent.condition) {
    const price = await market.getPrice(okxCreds, intent.condition.tokenAddress);
    if (!price) {
      return { error: "Could not fetch current price for condition check", warnings: [] };
    }
    const currentPrice = parseFloat(price.price);
    const target = intent.condition.targetPrice;
    const satisfied =
      intent.condition.type === "price_below" ? currentPrice < target : currentPrice > target;
    if (!satisfied) {
      return {
        error: `Price condition not met: current $${currentPrice.toFixed(4)}, target ${intent.condition.type === "price_below" ? "<" : ">"} $${target}`,
        warnings: [],
      };
    }
    console.log(`Price condition met: current $${currentPrice.toFixed(4)}\n`);
  }

  return swapViaBestRoute(intent.fromToken, intent.toToken, amount, privateKey, okxCreds);
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`
xlayer-swap-router v2 - Intelligent cross-protocol swap router for X Layer

Commands:
  quote <from> <to> <amount> <wallet>
      Compare routes between OnchainOS and Uniswap (read-only)

  analyze <from> <to> <amount> <wallet>
      Full analysis: market data, portfolio, smart slippage, multi-hop,
      and AI advice (read-only)

  swap <from> <to> <amount>
      Execute swap via best route with smart auto-slippage

  nl "<natural language command>"
      Parse and execute a natural language swap command
      Examples:
        "swap 100 USDT for OKB"
        "convert half my USDT to OKB"
        "swap 50 USDT to OKB if price is below 50"

  portfolio <wallet>
      Show wallet balances on X Layer

Environment variables required:
  OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE
  WALLET_PRIVATE_KEY (for swap/nl commands)
`);
    return;
  }

  const okxCreds: OkxCredentials = {
    apiKey: process.env.OKX_API_KEY || "",
    secretKey: process.env.OKX_SECRET_KEY || "",
    passphrase: process.env.OKX_PASSPHRASE || "",
  };

  if (!okxCreds.apiKey || !okxCreds.secretKey || !okxCreds.passphrase) {
    console.error("Error: Set OKX_API_KEY, OKX_SECRET_KEY, and OKX_PASSPHRASE environment variables");
    process.exit(1);
  }

  const command = args[0];

  if (command === "quote") {
    const [, fromToken, toToken, amount, walletAddress] = args;
    if (!fromToken || !toToken || !amount || !walletAddress) {
      console.error("Usage: quote <from> <to> <amount> <wallet>");
      process.exit(1);
    }
    const { summary } = await quote(fromToken, toToken, amount, walletAddress, okxCreds);
    console.log(summary);
  } else if (command === "analyze") {
    const [, fromToken, toToken, amount, walletAddress] = args;
    if (!fromToken || !toToken || !amount || !walletAddress) {
      console.error("Usage: analyze <from> <to> <amount> <wallet>");
      process.exit(1);
    }
    const { summary } = await analyze(fromToken, toToken, amount, walletAddress, okxCreds);
    console.log(summary);
  } else if (command === "swap") {
    const [, fromToken, toToken, amount] = args;
    const privateKey = process.env.WALLET_PRIVATE_KEY;
    if (!fromToken || !toToken || !amount || !privateKey) {
      console.error("Usage: swap <from> <to> <amount> (requires WALLET_PRIVATE_KEY)");
      process.exit(1);
    }
    const result = await swapViaBestRoute(fromToken, toToken, amount, privateKey, okxCreds);
    if (result.success) {
      console.log(`\nSwap successful via ${result.source}!`);
      console.log(`  Tx: https://www.okx.com/web3/explorer/xlayer/tx/${result.txHash}`);
    } else {
      console.error(`\nSwap failed: ${result.error}`);
      process.exit(1);
    }
  } else if (command === "nl") {
    const nlInput = args.slice(1).join(" ");
    const privateKey = process.env.WALLET_PRIVATE_KEY;
    if (!nlInput || !privateKey) {
      console.error('Usage: nl "<natural language>" (requires WALLET_PRIVATE_KEY)');
      process.exit(1);
    }
    const result = await swapFromNaturalLanguage(nlInput, privateKey, okxCreds);
    if ("success" in result && result.success) {
      console.log(`\nSwap successful via ${result.source}!`);
      console.log(`  Tx: https://www.okx.com/web3/explorer/xlayer/tx/${result.txHash}`);
    } else if ("error" in result) {
      const r = result as { error: string; warnings: string[] };
      console.error(`\nFailed: ${r.error}`);
      if (r.warnings.length > 0) {
        r.warnings.forEach((w: string) => console.error(`  - ${w}`));
      }
      process.exit(1);
    }
  } else if (command === "portfolio") {
    const [, walletAddress] = args;
    if (!walletAddress) {
      console.error("Usage: portfolio <wallet>");
      process.exit(1);
    }
    const portfolio = await portfolioMod.getPortfolio(okxCreds, walletAddress);
    console.log(portfolioMod.formatPortfolio(portfolio));
  } else {
    console.error(`Unknown command: ${command}. Run with --help for usage.`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
