#!/usr/bin/env node


import {
  OkxCredentials,
  SwapRequest,
  SwapResult,
  TOKENS,
  TOKEN_DECIMALS,
  toMinimalUnits,
  fromMinimalUnits,
  sourceLabel,
  resolveSymbol,
} from "./types";
import { findBestRoute, formatComparison } from "./router";
import * as onchainos from "./onchainos";
import * as uniswap from "./uniswap";
import * as market from "./market";
import * as portfolioMod from "./portfolio";
import * as multihop from "./multihop";
import * as pendingStore from "./pending";
import { createWallet, ensureApproval, executeSwap, getWalletInfo, getTokenBalanceOnChain } from "./wallet";
import { calculateSmartSlippage, formatSlippageRecommendation } from "./smartSlippage";
import { parseSwapIntent, generateSwapAdvice } from "./planner";

// Re-export everything
export { findBestRoute, formatComparison } from "./router";
export * as onchainos from "./onchainos";
export * as uniswap from "./uniswap";
export * as market from "./market";
export * as portfolio from "./portfolio";
export * as multihop from "./multihop";
export * as pending from "./pending";
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

/**
 * Tiny yes/no prompt. Returns true for Y/yes/empty (default yes), false for N/no.
 * If stdin isn't a TTY (scripted / piped), returns true so automated flows
 * keep working without hanging.
 */
function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(true);
      return;
    }
    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans: string) => {
      rl.close();
      const a = (ans || "").trim().toLowerCase();
      resolve(a === "" || a === "y" || a === "yes");
    });
  });
}

function resolveToken(token: string): string {
  if (token.startsWith("0x") || token.startsWith("0X")) return token;
  const addr = SYMBOL_MAP[token.toUpperCase()];
  if (!addr) throw new Error(`Unknown token symbol: ${token}. Use a contract address instead.`);
  return addr;
}

/**
 * Check if a wallet has enough of a token to spend a given minimal-unit amount.
 * Returns a structured result used to show a clear "Insufficient balance" message.
 */
export async function checkBalance(
  okxCreds: OkxCredentials,
  walletAddress: string,
  tokenAddress: string,
  neededMinimalUnits: string
): Promise<{
  sufficient: boolean;
  symbol: string;
  neededReadable: string;
  haveReadable: string;
  haveMinimalUnits: string;
}> {
  // Read the balance directly from X Layer's RPC — no OKX API dependency,
  // so this works even when OKX is unreachable from the user's network.
  void okxCreds;
  const symbol = resolveSymbol(tokenAddress);
  const decimals = TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;

  let have: bigint;
  try {
    have = await getTokenBalanceOnChain(walletAddress, tokenAddress);
  } catch {
    have = BigInt(0);
  }
  let need: bigint;
  try {
    need = BigInt(neededMinimalUnits);
  } catch {
    need = BigInt(0);
  }

  const fmt = (n: bigint) => {
    const s = n.toString().padStart(decimals + 1, "0");
    const whole = s.slice(0, -decimals) || "0";
    const frac = s.slice(-decimals).replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : whole;
  };

  return {
    sufficient: have >= need && need > BigInt(0),
    symbol,
    neededReadable: fmt(need),
    haveReadable: fmt(have),
    haveMinimalUnits: have.toString(),
  };
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

  // Parallel fetches. Also fetch the SOURCE token's live USD price so we can
  // compute the trade's dollar size correctly regardless of token decimals.
  const [comparison, tradingInfo, candles, portfolio, multiHopRoutes, fromLivePrice] = await Promise.all([
    findBestRoute({ fromToken: fromAddr, toToken: toAddr, amount, walletAddress }, okxCreds).catch(() => null),
    market.getTradingInfo(okxCreds, toAddr),
    market.getCandlesticks(okxCreds, toAddr, "1H", 24),
    portfolioMod.getPortfolio(okxCreds, walletAddress),
    multihop.findMultiHopRoutes(okxCreds, fromAddr, toAddr, amount),
    market.getLivePriceUsd(okxCreds, fromAddr).catch(() => null),
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

  // 5. Smart slippage recommendation.
  // USD size of the trade = (source amount in full tokens) × (source token's live $ price).
  // Using the SOURCE token's price is the only correct formulation — destination
  // price would give wrong numbers whenever source and destination aren't equivalent.
  const fromDecimals = TOKEN_DECIMALS[fromAddr.toLowerCase()] ?? 18;
  const fromUnits = parseFloat(amount) / Math.pow(10, fromDecimals);
  const tradeAmountUsd = fromLivePrice
    ? fromUnits * fromLivePrice.priceUsd
    : fromUnits; // fallback assumes ~$1 (fine for stables)
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

  // Insufficient balance guard (skipped for native OKB; ethers-level gas check handles that)
  const isNative = fromAddr.toLowerCase() === TOKENS.NATIVE_OKB.toLowerCase();
  if (!isNative) {
    const bal = await checkBalance(okxCreds, wallet.address, fromAddr, amount);
    if (!bal.sufficient) {
      return {
        success: false,
        source: "onchainos",
        fromToken: fromAddr,
        toToken: toAddr,
        fromAmount: amount,
        toAmount: "0",
        error: `Insufficient balance. Needed ${bal.neededReadable} ${bal.symbol}, have ${bal.haveReadable} ${bal.symbol}.`,
      };
    }
  }

  // Auto-calculate slippage if not provided
  if (slippagePercent === undefined) {
    console.log("Calculating smart slippage...");
    const [tradingInfo, candles, fromLivePrice] = await Promise.all([
      market.getTradingInfo(okxCreds, toAddr),
      market.getCandlesticks(okxCreds, toAddr, "1H", 24),
      market.getLivePriceUsd(okxCreds, fromAddr).catch(() => null),
    ]);
    const fromDecimals = TOKEN_DECIMALS[fromAddr.toLowerCase()] ?? 18;
    const fromUnits = parseFloat(amount) / Math.pow(10, fromDecimals);
    const tradeAmountUsd = fromLivePrice
      ? fromUnits * fromLivePrice.priceUsd
      : fromUnits;
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
  // Route the approval to the winning aggregator's contract, not unconditionally OKX.
  await ensureApproval(wallet, fromAddr, amount, okxCreds, best.source);

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
 * Options for natural language swap execution.
 */
export interface NlSwapOptions {
  /**
   * If a price condition is in the intent and it's not met right now, poll
   * the live price until it is (or until `watchTimeoutMs` elapses). Default true.
   * Set false to get the old one-shot behavior (abort immediately if unmet).
   */
  watch?: boolean;
  /** Polling interval in ms. Default 30_000 (30s). */
  watchIntervalMs?: number;
  /** Total watch duration before giving up, in ms. Default 3_600_000 (1 hour). */
  watchTimeoutMs?: number;
}

/**
 * Parse a natural language swap command and execute it.
 *
 * If the parsed intent contains a price condition (e.g. "swap if OKB below $50"),
 * this will poll the live aggregator-derived price at a regular interval and
 * fire the swap the moment the condition is satisfied. Pass `{ watch: false }`
 * to get the legacy one-shot behavior.
 */
export async function swapFromNaturalLanguage(
  input: string,
  privateKey: string,
  okxCreds: OkxCredentials,
  options: NlSwapOptions = {}
): Promise<SwapResult | { error: string; warnings: string[] }> {
  const watch = options.watch ?? true;
  const watchIntervalMs = options.watchIntervalMs ?? 30_000;
  const watchTimeoutMs = options.watchTimeoutMs ?? 3_600_000;
  const { intent, warnings, summary } = parseSwapIntent(input);
  console.log(`Understood: ${summary}\n`);

  if (warnings.length > 0) {
    return { error: "Could not parse swap intent", warnings };
  }

  // Resolve amount to minimal units depending on amountType.
  let amount = intent.amount;
  const wallet = createWallet(privateKey);

  if (intent.amountType === "exact") {
    // Convert human-readable amount (e.g. "0.5") to minimal units (e.g. "500000")
    amount = toMinimalUnits(intent.amount, intent.fromToken);
  } else if (intent.amountType === "dollar") {
    // Convert a USD value to token amount using a live aggregator-derived price.
    const livePrice = await market.getLivePriceUsd(okxCreds, intent.fromToken);
    if (!livePrice) {
      return { error: `Could not derive a live price for the source token (no USDC route available)`, warnings: [] };
    }
    const price = livePrice.priceUsd;
    const dollars = parseFloat(intent.amount);
    const tokenAmount = dollars / price;
    const humanAmount = tokenAmount.toFixed(18).replace(/0+$/, "").replace(/\.$/, "");
    amount = toMinimalUnits(humanAmount, intent.fromToken);
    const fromSym = resolveSymbol(intent.fromToken);
    console.log(`Resolved $${dollars.toFixed(2)} at live price $${price.toFixed(6)} -> ${humanAmount} ${fromSym} (${sourceLabel(livePrice.source)})\n`);
  } else {
    // percentage or all — read balance directly from the X Layer RPC.
    let fullBalance: bigint;
    try {
      fullBalance = await getTokenBalanceOnChain(wallet.address, intent.fromToken);
    } catch {
      fullBalance = BigInt(0);
    }
    if (fullBalance === BigInt(0)) {
      return { error: `No balance found for source token in wallet. Insufficient balance.`, warnings: [] };
    }
    // Native OKB pays for gas — can't send 100% or the tx can't pay fees.
    // Reserve a small buffer (0.002 OKB ≈ plenty for a swap tx on X Layer).
    const isNativeFrom = intent.fromToken.toLowerCase() === TOKENS.NATIVE_OKB.toLowerCase();
    const GAS_BUFFER_NATIVE = BigInt("2000000000000000"); // 0.002 OKB (18 dp)
    let spendable = fullBalance;
    if (isNativeFrom) {
      spendable = fullBalance > GAS_BUFFER_NATIVE ? fullBalance - GAS_BUFFER_NATIVE : BigInt(0);
      if (spendable === BigInt(0)) {
        return { error: `Not enough OKB to swap after reserving gas. Need > 0.002 OKB in the wallet.`, warnings: [] };
      }
    }
    if (intent.amountType === "all") {
      amount = spendable.toString();
    } else {
      // Use basis points (0-10000) so fractional percentages like 33.3 aren't lost.
      const pct = parseFloat(intent.amount);
      const bps = BigInt(Math.floor(pct * 100));
      amount = ((spendable * bps) / BigInt(10000)).toString();
    }
    const sym = resolveSymbol(intent.fromToken);
    const human = fromMinimalUnits(amount, intent.fromToken);
    const gasNote = isNativeFrom ? ` — reserved 0.002 ${sym} for gas` : "";
    console.log(`Resolved amount: ${human} ${sym} (${intent.amountType} of ${sym} balance${gasNote})\n`);
  }

  // Balance check — refuse upfront if the wallet doesn't have enough.
  const balanceCheck = await checkBalance(okxCreds, wallet.address, intent.fromToken, amount);
  if (!balanceCheck.sufficient) {
    return {
      error: `Insufficient balance. Needed ${balanceCheck.neededReadable} ${balanceCheck.symbol}, have ${balanceCheck.haveReadable} ${balanceCheck.symbol}.`,
      warnings: [],
    };
  }

  // Conditional swap handling.
  //
  // If the intent has a price condition, check the live price once:
  //   - met now  → fall through and swap immediately.
  //   - not met  → by default (watch=true), persist this swap to the pending
  //     store and exit. The user runs `xlayer-swap watch` (in a persistent
  //     terminal, tmux, systemd, etc.) to actually poll + execute. This way
  //     a "5 days later" condition genuinely survives process exits.
  //     Pass {watch:false} for the legacy "abort now" behavior.
  void watchIntervalMs; void watchTimeoutMs;
  if (intent.condition) {
    const cond = intent.condition;
    const isMet = (p: number) =>
      cond.type === "price_below" ? p < cond.targetPrice : p > cond.targetPrice;
    const dir = cond.type === "price_below" ? "<" : ">";

    const firstPrice = await market.getLivePriceUsd(okxCreds, cond.tokenAddress);
    if (!firstPrice) {
      return { error: "Could not derive a live price to check the condition", warnings: [] };
    }

    if (isMet(firstPrice.priceUsd)) {
      console.log(`Price condition met: current $${firstPrice.priceUsd.toFixed(4)} ${dir} $${cond.targetPrice} (${sourceLabel(firstPrice.source)})\n`);
    } else if (!watch) {
      return {
        error: `Price condition not met: current $${firstPrice.priceUsd.toFixed(4)}, target ${dir} $${cond.targetPrice}`,
        warnings: [],
      };
    } else {
      // Condition not met right now. Show the live price and ask the user
      // whether to save this for later or cancel. Non-TTY / piped stdin
      // (e.g. CI, scripted invocations) auto-saves — no prompt.
      const condSym = resolveSymbol(cond.tokenAddress);
      const fromSym = resolveSymbol(intent.fromToken);
      const toSym = resolveSymbol(intent.toToken);
      const humanAmt = fromMinimalUnits(amount, intent.fromToken);

      console.log(`\nCondition not yet met.`);
      console.log(`  Current ${condSym} price:  $${firstPrice.priceUsd.toFixed(4)} (${sourceLabel(firstPrice.source)})`);
      console.log(`  Target:                ${dir} $${cond.targetPrice}`);
      console.log(`  Swap waiting:          ${humanAmt} ${fromSym} -> ${toSym}`);
      console.log("");

      const answer = await promptYesNo(
        "Save to pending so it auto-executes when the condition is met? [Y/n] "
      );

      if (!answer) {
        console.log(`Cancelled. Nothing saved. No transaction sent.`);
        return {
          success: false,
          source: "onchainos",
          fromToken: intent.fromToken,
          toToken: intent.toToken,
          fromAmount: amount,
          toAmount: "0",
          error: "Cancelled by user at condition-not-met prompt.",
        };
      }

      const id = pendingStore.newId();
      pendingStore.addPending({
        id,
        createdAt: new Date().toISOString(),
        nlInput: input,
        fromToken: intent.fromToken,
        toToken: intent.toToken,
        amountMinimal: amount,
        walletAddress: wallet.address,
        condition: cond,
      });
      const daemonStatus = ensureWatchDaemon();
      console.log(`\nSaved. It will auto-execute when the condition is met.`);
      if (daemonStatus === "spawned") {
        console.log(`Auto-started a background watcher — no extra command needed.`);
      } else if (daemonStatus === "already-running") {
        console.log(`Background watcher already running — your swap is being monitored.`);
      } else {
        console.log(`Note: auto-start failed. Run \`swap watch\` manually to monitor.`);
      }
      console.log(`\nNext steps:`);
      console.log(`  swap pending        # see your numbered list of pending swaps`);
      console.log(`  swap cancel all     # wipe every pending swap`);
      return {
        success: true,
        source: "onchainos",
        fromToken: intent.fromToken,
        toToken: intent.toToken,
        fromAmount: amount,
        toAmount: "0",
        pendingId: id,
      } as SwapResult;
    }
  }

  return swapViaBestRoute(intent.fromToken, intent.toToken, amount, privateKey, okxCreds);
}

/**
 * Poll live prices and execute any pending conditional swaps whose condition
 * becomes satisfied. Runs until Ctrl+C — intended to be left running in a
 * separate terminal / tmux / systemd unit. Safe to restart; the pending store
 * is the source of truth.
 */
/**
 * Ensures a background `watch` process is running. Called after a pending
 * swap is saved so the user doesn't have to remember to start a watcher.
 * Returns "already-running" | "spawned" | "failed".
 *
 * The spawned child is fully detached — it survives closing the parent's
 * terminal. It inherits the current env (private key, OKX creds, etc.).
 */
export function ensureWatchDaemon(): "already-running" | "spawned" | "failed" {
  try {
    const existing = pendingStore.getRunningWatchPid();
    if (existing) return "already-running";

    // Must have a private key to execute — if missing, don't spawn.
    if (!process.env.WALLET_PRIVATE_KEY) return "failed";

    const { spawn } = require("child_process");
    const path = require("path");
    const fs = require("fs");
    const os = require("os");

    const logDir = path.join(os.homedir(), ".xlayer-swap");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, "watch.log");
    const out = fs.openSync(logFile, "a");
    const err = fs.openSync(logFile, "a");

    // Re-invoke ourselves with the `watch` subcommand. process.argv[1] is
    // the currently-running script (dist/index.js when installed globally).
    const child = spawn(process.execPath, [process.argv[1], "watch"], {
      detached: true,
      stdio: ["ignore", out, err],
      env: process.env,
      windowsHide: true,
    });
    child.unref();
    return "spawned";
  } catch {
    return "failed";
  }
}

export async function watchPending(
  privateKey: string,
  okxCreds: OkxCredentials,
  pollIntervalMs: number = 30_000
): Promise<void> {
  console.log(`Starting pending-swap watcher. Polling every ${Math.round(pollIntervalMs / 1000)}s. Ctrl+C to stop.\n`);
  // Record our pid so `ensureWatchDaemon()` doesn't spawn duplicates.
  pendingStore.writeWatchPid(process.pid);
  const cleanup = () => { pendingStore.clearWatchPid(); process.exit(0); };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("exit", () => pendingStore.clearWatchPid());
  // Log a heartbeat immediately so the user knows it's alive.
  const tick = async () => {
    const list = pendingStore.loadPending();
    if (list.length === 0) {
      console.log(`[${new Date().toISOString()}] No pending swaps. Waiting...`);
      return;
    }
    // Use the 1-based position in the current list as the tag. Matches the
    // number the user sees in `xlayer-swap pending` — no ids surfaced.
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const tag = `#${i + 1}`;
      const price = await market.getLivePriceUsd(okxCreds, s.condition.tokenAddress).catch(() => null);
      if (!price) {
        console.log(`[${new Date().toISOString()}] ${tag} price fetch failed, will retry next tick.`);
        continue;
      }
      const isMet =
        s.condition.type === "price_below"
          ? price.priceUsd < s.condition.targetPrice
          : price.priceUsd > s.condition.targetPrice;
      const dir = s.condition.type === "price_below" ? "<" : ">";
      const condSym = resolveSymbol(s.condition.tokenAddress);
      console.log(
        `[${new Date().toISOString()}] ${tag} ${condSym} $${price.priceUsd.toFixed(4)} (need ${dir} $${s.condition.targetPrice}) — ${isMet ? "MET" : "waiting"}`
      );
      if (isMet) {
        console.log(`\n${tag} Condition met — executing: ${s.nlInput}`);
        try {
          const result = await swapViaBestRoute(
            s.fromToken,
            s.toToken,
            s.amountMinimal,
            privateKey,
            okxCreds
          );
          if (result.success) {
            const inH = fromMinimalUnits(result.fromAmount, result.fromToken);
            const outH = fromMinimalUnits(result.toAmount, result.toToken);
            console.log(
              `${tag} Successfully swapped ${inH} ${resolveSymbol(result.fromToken)} for ${outH} ${resolveSymbol(result.toToken)} via ${sourceLabel(result.source)}!`
            );
            console.log(`${tag} Tx: https://www.okx.com/web3/explorer/xlayer/tx/${result.txHash}`);
            pendingStore.removePending(s.id);
          } else {
            console.error(`${tag} Execution failed: ${result.error}. Keeping in pending list to retry next tick.`);
          }
        } catch (err: any) {
          console.error(`${tag} Error executing: ${err?.message || err}. Keeping in pending list.`);
        }
      }
    }
  };

  // First tick immediately, then on interval.
  await tick();
  const timer: NodeJS.Timeout = setInterval(() => { tick().catch((e) => console.error(e)); }, pollIntervalMs);
  // Keep the process alive indefinitely. Ctrl+C exits.
  await new Promise<void>(() => { void timer; });
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

  price <token>
      Show live price for a token (OKB, USDT, USDC, WETH, or 0x...)

  nl "<natural language command>" [--no-watch]
      Parse and execute a natural language swap command.
      Shorthand: you can drop the "nl" keyword entirely —
          xlayer-swap "swap $1 of OKB to USDT"
      works the same as
          xlayer-swap nl "swap $1 of OKB to USDT"

      Conditional phrasings (e.g. "if OKB below $50") are SAVED to your
      pending list and will auto-execute when the condition is met —
      provided a \`watch\` process is running. Use --no-watch for legacy
      one-shot mode (abort immediately if the condition isn't met now).

  pending
      List all saved conditional swaps, numbered 1..N with their details.

  cancel <number|all>
      Remove a saved conditional swap so it won't execute.
      Use the number from the \`pending\` list, or \`all\` to wipe everything:
          xlayer-swap cancel 1        # cancel the first pending swap
          xlayer-swap cancel 3        # cancel the third pending swap
          xlayer-swap cancel all      # cancel every pending swap

  watch
      Run a persistent price monitor that executes any pending conditional
      swaps the moment their condition is met. Runs until Ctrl+C — leave
      in a background terminal/tmux/systemd unit so "5 days later" really
      means 5 days later.

  portfolio <wallet>
      Show wallet balances on X Layer

NL EXAMPLES:
  Basic:
    "swap 100 USDT for OKB"             "swap 0.5 OKB to USDT"
    "convert 10 USDT to USDC"           "sell 50 USDT for WETH"
    "trade 5 OKB for USDT"              "exchange 20 USDC to USDT"

  Slangy:
    "flip 5 OKB to USDT"                "dump all my USDT into OKB"
    "yeet 100 USDT into OKB"            "move 20 USDT to OKB"
    "turn 50 USDT into OKB"             "ape 10 USDT into OKB"

  Portions of balance:
    "swap half my USDT to OKB"          "swap all my WETH for USDT"
    "swap my entire USDT balance to OKB"
    "convert 25% of my OKB to USDT"     "swap 10% of my USDT for OKB"
    "a quarter of my USDT to OKB"       "a tenth of my OKB for USDT"
    "two thirds of my OKB for USDT"

  Dollar-value (use "usd"/"dollars"/"bucks" to avoid $-expansion on bash/zsh):
    "swap 5 usd of OKB to USDT"         "swap 100 dollars of USDT to OKB"
    "swap $5 worth of OKB to USDT"      "swap $100 of USDT to OKB"
    "swap 20 bucks of OKB to USDT"      "$20 of OKB to USDT"

  Conditional (waits/aborts if condition not met):
    "swap 100 USDT for OKB if price is below 50"
    "swap 100 USDT to OKB when price is above 60"
    "swap 50 USDT to OKB if OKB is below $45"
    "swap 1 USDT to OKB if price above $55"
    "swap 100 USDT for OKB once price drops to 40"

  Buy-side:
    "buy OKB with 100 USDT"             "purchase OKB using 50 USDT"

Environment variables required:
  OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE
  WALLET_PRIVATE_KEY (for swap/nl/watch commands)

A .env file in the current directory is auto-loaded when running as CLI,
so you do NOT need to prefix \`node -r dotenv/config\`. Just run the command.

Cross-platform:
  Works on Windows, macOS, and Linux. Install once with \`npm install -g .\`
  and the \`swap\`, \`xswap\`, \`xlayer-swap\` commands land on your PATH.
  On bash/zsh (macOS/Linux) the shell expands \`$1\` to an empty string, so
  prefer \`1 usd\` / \`5 dollars\` / \`10 bucks\` or single-quote the sentence:
      swap '\$1 of OKB to USDT'.
  All three forms parse to the same dollar-value intent.
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

  // Bare-NL shorthand with two modes:
  //
  // 1. Invoked as `swap`/`xswap` binary (whole verb is the program name):
  //      swap $1 of OKB to USDT
  //    → args starts with "$1", no "swap" keyword present, but the invocation
  //    name tells us this is always NL. We synthesize the verb.
  //
  // 2. Invoked as `xlayer-swap`/`xlayer-swap-router` with an NL sentence:
  //      xlayer-swap "swap $1 of OKB to USDT"
  //    → args[0] is "swap", the first word of the NL command.
  //    KNOWN_COMMANDS.has("swap") is true — but if there are more args AND
  //    they don't match the <from> <to> <amount> positional swap form,
  //    treat it as NL.
  const KNOWN_COMMANDS = new Set([
    "quote", "analyze", "swap", "price", "nl",
    "portfolio", "pending", "cancel", "watch",
  ]);
  const path = require("path");
  const invokedAs = path.basename(process.argv[1] || "").replace(/\.js$/i, "").toLowerCase();
  const isNlBinary = invokedAs === "swap" || invokedAs === "xswap";

  let command = args[0];
  let nlShorthand = false;

  if (isNlBinary) {
    // The program name IS the verb. Everything we got is the NL sentence.
    command = "nl";
    nlShorthand = true;
  } else if (!KNOWN_COMMANDS.has(command)) {
    // Unknown first token — route to the NL parser. It has its own
    // clear error messages for gibberish, and this lets bare forms like
    // `swap 10% of my USDT to OKB` work on Windows where npm wraps the
    // binary via a .cmd shim (so process.argv[1] isn't the bin name).
    if (command && !command.startsWith("-")) {
      command = "nl";
      nlShorthand = true;
    }
  } else if (command === "swap") {
    // Disambiguate `xlayer-swap swap ...`:
    //   - Positional form: `swap OKB USDT 1000000000000000000` → 4 args, all short tokens/numbers.
    //   - NL form:          `swap $1 of OKB to USDT` → contains "of"/"to"/"for"/"$".
    // If any NL marker is present, route to nl.
    const rest = args.slice(1).join(" ").toLowerCase();
    if (/\b(of|to|for|into|if|when|once|with|worth|%|half|quarter|third|entire|all|my)\b|\$/.test(rest)) {
      command = "nl";
      nlShorthand = true;
    }
  }

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
      const inH = fromMinimalUnits(result.fromAmount, result.fromToken);
      const outH = fromMinimalUnits(result.toAmount, result.toToken);
      const inSym = resolveSymbol(result.fromToken);
      const outSym = resolveSymbol(result.toToken);
      console.log(`\nSuccessfully swapped ${inH} ${inSym} for ${outH} ${outSym} via ${sourceLabel(result.source)}!`);
      console.log(`  Tx: https://www.okx.com/web3/explorer/xlayer/tx/${result.txHash}`);
    } else {
      console.error(`\nSwap failed: ${result.error}`);
      process.exit(1);
    }
  } else if (command === "nl") {
    // --no-watch: legacy one-shot mode. Otherwise conditional swaps persist.
    // `nlShorthand` keeps ALL args (no "nl" keyword to strip).
    const cliArgs = nlShorthand ? args : args.slice(1);
    const noWatch = cliArgs.includes("--no-watch");
    const nlInput = cliArgs.filter((a) => a !== "--no-watch").join(" ");
    const privateKey = process.env.WALLET_PRIVATE_KEY;
    if (!nlInput || !privateKey) {
      console.error('Usage: nl "<natural language>" [--no-watch] (requires WALLET_PRIVATE_KEY)');
      process.exit(1);
    }
    const result = await swapFromNaturalLanguage(nlInput, privateKey, okxCreds, { watch: !noWatch });
    if ("success" in result && result.success) {
      // Saved-to-pending case already printed its own message in
      // swapFromNaturalLanguage; nothing to print here.
      if (!result.pendingId) {
        const inH = fromMinimalUnits(result.fromAmount, result.fromToken);
        const outH = fromMinimalUnits(result.toAmount, result.toToken);
        const inSym = resolveSymbol(result.fromToken);
        const outSym = resolveSymbol(result.toToken);
        console.log(`\nSuccessfully swapped ${inH} ${inSym} for ${outH} ${outSym} via ${sourceLabel(result.source)}!`);
        console.log(`  Tx: https://www.okx.com/web3/explorer/xlayer/tx/${result.txHash}`);
      }
    } else if ("success" in result && !result.success) {
      // SwapResult with success=false (includes user-cancelled-at-prompt).
      // The prompt branch already printed its own "Cancelled." message, so
      // exit quietly with code 0. For other failures, show the error.
      if (result.error && !/cancelled by user/i.test(result.error)) {
        console.error(`\nSwap failed: ${result.error}`);
        process.exit(1);
      }
    } else if ("error" in result) {
      const r = result as { error: string; warnings: string[] };
      console.error(`\nFailed: ${r.error}`);
      if (r.warnings.length > 0) {
        r.warnings.forEach((w: string) => console.error(`  - ${w}`));
      }
      process.exit(1);
    }
  } else if (command === "price") {
    const [, tokenArg] = args;
    if (!tokenArg) {
      console.error("Usage: price <token>  (e.g. price OKB)");
      process.exit(1);
    }
    const tokenAddrRaw = resolveToken(tokenArg);
    const tokenSym = resolveSymbol(tokenAddrRaw);
    const tokenAddr = tokenAddrRaw.toLowerCase() === TOKENS.NATIVE_OKB.toLowerCase()
      ? TOKENS.WOKB
      : tokenAddrRaw;
    const [livePrice, tradingInfo] = await Promise.all([
      market.getLivePriceUsd(okxCreds, tokenAddr),
      market.getTradingInfo(okxCreds, tokenAddr).catch(() => null),
    ]);
    if (!livePrice) {
      console.error(`Could not fetch live price for ${tokenSym}. No aggregator route to USDC.`);
      process.exit(1);
    }
    const sourceDesc = livePrice.source === "stable"
      ? "stablecoin (pegged to $1)"
      : livePrice.source === "onchainos"
      ? "live quote via OKX OnchainOS aggregator (best route)"
      : "live quote via Uniswap Trading API (best route)";
    // Format: 2dp for values >= $1 (e.g. "$85.43"), 6dp for sub-dollar tokens.
    const p = livePrice.priceUsd;
    const priceStr = p >= 1 ? `$${p.toFixed(2)}` : `$${p.toFixed(6)}`;
    console.log(`\n=== Live Price: ${tokenSym} ===`);
    console.log(`  Price:        ${priceStr}`);
    if (tradingInfo) {
      console.log(`  24h Change:   ${parseFloat(tradingInfo.priceChange24H).toFixed(2)}%`);
      console.log(`  24h Volume:   $${(parseFloat(tradingInfo.volume24H) / 1e6).toFixed(2)}M`);
      console.log(`  Liquidity:    $${(parseFloat(tradingInfo.liquidity) / 1e6).toFixed(2)}M`);
      console.log(`  Market Cap:   $${(parseFloat(tradingInfo.marketCap) / 1e9).toFixed(2)}B`);
    }
    console.log(`  Source:       ${sourceDesc}`);
    console.log();
  } else if (command === "portfolio") {
    const [, walletAddress] = args;
    if (!walletAddress) {
      console.error("Usage: portfolio <wallet>");
      process.exit(1);
    }
    const portfolio = await portfolioMod.getPortfolio(okxCreds, walletAddress);
    console.log(portfolioMod.formatPortfolio(portfolio));
  } else if (command === "pending") {
    const list = pendingStore.loadPending();
    console.log(pendingStore.formatPending(list));
  } else if (command === "cancel") {
    const target = args[1];
    if (!target) {
      console.error("Usage: xlayer-swap cancel <number|all>");
      console.error("       xlayer-swap cancel 1      # cancel the first pending swap");
      console.error("       xlayer-swap cancel all    # cancel every pending swap");
      console.error("\nRun `xlayer-swap pending` to see the numbered list.");
      process.exit(1);
    }
    const resolved = pendingStore.resolveCancelTarget(target);
    if (resolved === "all") {
      const n = pendingStore.removeAll();
      if (n === 0) {
        console.log("Nothing to cancel — pending list was already empty.");
      } else {
        console.log(`Cancelled all ${n} pending swap${n === 1 ? "" : "s"}.`);
      }
    } else if (resolved === null) {
      console.error(`No pending swap at position "${target}". Run \`xlayer-swap pending\` to see the numbered list.`);
      process.exit(1);
    } else {
      pendingStore.removePending(resolved);
      console.log(`Cancelled pending swap #${target}.`);
    }
  } else if (command === "watch") {
    const privateKey = process.env.WALLET_PRIVATE_KEY;
    if (!privateKey) {
      console.error("Usage: watch  (requires WALLET_PRIVATE_KEY so it can execute when conditions are met)");
      process.exit(1);
    }
    await watchPending(privateKey, okxCreds);
  } else {
    console.error(`Unknown command: ${command}. Run with --help for usage.`);
    process.exit(1);
  }
}

if (require.main === module) {
  // CLI-only: auto-load .env so users don't have to prefix `-r dotenv/config`.
  // Gated behind the `require.main === module` check so library consumers
  // who `import` this package don't get their env silently mutated.
  // Auto-load .env from two places, in order:
  //   1. The current working directory (project-scoped config).
  //   2. ~/.xlayer-swap/.env (global config — set once, works from anywhere).
  // First match wins; dotenv does not overwrite already-set vars.
  try {
    const dotenv = require("dotenv");
    dotenv.config({ quiet: true });
    const os = require("os");
    const path = require("path");
    dotenv.config({ path: path.join(os.homedir(), ".xlayer-swap", ".env"), quiet: true });
  } catch { /* dotenv optional */ }
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

