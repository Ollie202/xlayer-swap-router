import {
  OkxCredentials,
  OKX_API_BASE,
  XLAYER_CHAIN_ID,
  TOKENS,
  TOKEN_DECIMALS,
} from "./types";
import * as onchainos from "./onchainos";
import * as uniswap from "./uniswap";
import crypto from "crypto";

function createSignature(
  timestamp: string,
  method: string,
  path: string,
  body: string,
  secretKey: string
): string {
  const preHash = timestamp + method.toUpperCase() + path + body;
  return crypto.createHmac("sha256", secretKey).update(preHash).digest("base64");
}

function buildHeaders(
  creds: OkxCredentials,
  method: string,
  path: string,
  body: string = ""
): Record<string, string> {
  const timestamp = new Date().toISOString();
  const signPath = "/api/v6" + path;
  const sign = createSignature(timestamp, method, signPath, body, creds.secretKey);
  return {
    "OK-ACCESS-KEY": creds.apiKey,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": creds.passphrase,
    "Content-Type": "application/json",
  };
}

export interface TokenPrice {
  price: string;
  time: string;
}

export interface TokenTradingInfo {
  price: string;
  marketCap: string;
  priceChange24H: string;
  volume24H: string;
  liquidity: string;
  holders: string;
}

export interface Candlestick {
  ts: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  volumeUsd: string;
}

export interface LiquiditySource {
  id: string;
  name: string;
}

/**
 * Get current price for a token on X Layer.
 */
export async function getPrice(
  creds: OkxCredentials,
  tokenAddress: string
): Promise<TokenPrice | null> {
  const path = `/dex/market/price`;
  // OKX price endpoint expects a JSON array of {chainIndex, tokenContractAddress}
  const body = JSON.stringify([
    { chainIndex: XLAYER_CHAIN_ID, tokenContractAddress: tokenAddress },
  ]);
  const url = OKX_API_BASE + path;
  const headers = buildHeaders(creds, "POST", path, body);

  try {
    const res = await fetch(url, { method: "POST", headers, body });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (data.code !== "0" || !data.data?.[0]) return null;
    return {
      price: data.data[0].price,
      time: data.data[0].time,
    };
  } catch {
    return null;
  }
}

/**
 * Get detailed trading info (price, volume, liquidity, market cap, holders).
 */
export async function getTradingInfo(
  creds: OkxCredentials,
  tokenAddress: string
): Promise<TokenTradingInfo | null> {
  const path = `/dex/market/price-info`;
  // OKX price-info endpoint expects a JSON array of {chainIndex, tokenContractAddress}
  const body = JSON.stringify([
    { chainIndex: XLAYER_CHAIN_ID, tokenContractAddress: tokenAddress },
  ]);
  const url = OKX_API_BASE + path;
  const headers = buildHeaders(creds, "POST", path, body);

  try {
    const res = await fetch(url, { method: "POST", headers, body });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (data.code !== "0" || !data.data?.[0]) return null;
    const d = data.data[0];
    return {
      price: d.price || "0",
      marketCap: d.marketCap || "0",
      priceChange24H: d.priceChange24H || "0",
      volume24H: d.volume24H || "0",
      liquidity: d.liquidity || "0",
      holders: d.holders || "0",
    };
  } catch {
    return null;
  }
}

/**
 * Get recent candlesticks for volatility analysis.
 */
export async function getCandlesticks(
  creds: OkxCredentials,
  tokenAddress: string,
  bar: string = "1H",
  limit: number = 24
): Promise<Candlestick[]> {
  const params = new URLSearchParams({
    chainIndex: XLAYER_CHAIN_ID,
    tokenContractAddress: tokenAddress,
    bar,
    limit: limit.toString(),
  });
  const path = `/dex/market/candles?${params}`;
  const url = OKX_API_BASE + path;
  const headers = buildHeaders(creds, "GET", path);

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const data: any = await res.json();
    if (data.code !== "0" || !data.data) return [];
    return data.data.map((c: any) => ({
      ts: c.ts,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
      volume: c.vol,
      volumeUsd: c.volUsd,
    }));
  } catch {
    return [];
  }
}

/**
 * Get available liquidity sources (DEXes) on X Layer.
 */
export async function getLiquiditySources(
  creds: OkxCredentials
): Promise<LiquiditySource[]> {
  const params = new URLSearchParams({ chainIndex: XLAYER_CHAIN_ID });
  const path = `/dex/aggregator/get-liquidity?${params}`;
  const url = OKX_API_BASE + path;
  const headers = buildHeaders(creds, "GET", path);

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const data: any = await res.json();
    if (data.code !== "0" || !data.data) return [];
    return data.data.map((s: any) => ({ id: s.id, name: s.name }));
  } catch {
    return [];
  }
}

/**
 * Format market data into a readable analysis string.
 */
export function formatMarketAnalysis(
  tokenSymbol: string,
  info: TokenTradingInfo,
  candles: Candlestick[]
): string {
  const lines: string[] = [];
  lines.push(`=== Market Analysis: ${tokenSymbol} ===\n`);
  lines.push(`  Price:           $${parseFloat(info.price).toFixed(6)}`);
  lines.push(`  24h Change:      ${parseFloat(info.priceChange24H).toFixed(2)}%`);
  lines.push(`  24h Volume:      $${formatUsd(info.volume24H)}`);
  lines.push(`  Liquidity:       $${formatUsd(info.liquidity)}`);
  lines.push(`  Market Cap:      $${formatUsd(info.marketCap)}`);
  lines.push(`  Holders:         ${info.holders}`);

  if (candles.length > 0) {
    const volatility = calculateVolatility(candles);
    lines.push(`\n  Volatility (24h): ${volatility.toFixed(2)}%`);

    const trend = detectTrend(candles);
    lines.push(`  Trend:           ${trend}`);
  }

  return lines.join("\n");
}

function formatUsd(val: string): string {
  const n = parseFloat(val);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(2) + "K";
  return n.toFixed(2);
}

/**
 * Calculate price volatility from candlesticks (standard deviation of returns).
 */
function calculateVolatility(candles: Candlestick[]): number {
  if (candles.length < 2) return 0;

  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = parseFloat(candles[i - 1].close);
    const curr = parseFloat(candles[i].close);
    if (prev > 0) returns.push(((curr - prev) / prev) * 100);
  }

  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

/**
 * Simple trend detection from candlestick closes.
 */
function detectTrend(candles: Candlestick[]): string {
  if (candles.length < 3) return "Insufficient data";

  const recent = candles.slice(-6);
  const first = parseFloat(recent[0].close);
  const last = parseFloat(recent[recent.length - 1].close);
  const change = ((last - first) / first) * 100;

  if (change > 5) return "Strong uptrend";
  if (change > 1) return "Mild uptrend";
  if (change < -5) return "Strong downtrend";
  if (change < -1) return "Mild downtrend";
  return "Sideways / consolidating";
}

/**
 * Derive a live USD price for a token by asking the actual swap routers
 * "what would one unit of this token swap to, in USDC?". This is always
 * accurate because it's exactly what the chain would pay you right now —
 * no stale feed, no oracle, just the live aggregator quote.
 *
 * Quotes both OnchainOS and Uniswap in parallel and takes the better
 * quote, so the price reflects the best execution available on X Layer.
 *
 * For stablecoins (USDC/USDT) we return $1 directly to avoid a pointless
 * round-trip.
 */
export async function getLivePriceUsd(
  creds: OkxCredentials,
  tokenAddress: string
): Promise<{ priceUsd: number; source: "onchainos" | "uniswap" | "stable" } | null> {
  const lower = tokenAddress.toLowerCase();
  const USDC = TOKENS.USDC.toLowerCase();
  const USDT = TOKENS.USDT.toLowerCase();

  if (lower === USDC || lower === USDT) {
    return { priceUsd: 1.0, source: "stable" };
  }

  // Native OKB placeholder isn't a real ERC-20 for aggregator purposes; use WOKB.
  const quoteAddr =
    lower === TOKENS.NATIVE_OKB.toLowerCase() ? TOKENS.WOKB : tokenAddress;

  const tokenDecimals = TOKEN_DECIMALS[quoteAddr.toLowerCase()] ?? 18;
  // Use 1 full token worth as the quote size — enough for price discovery,
  // small enough that price impact doesn't distort the answer.
  const oneUnit = (BigInt(10) ** BigInt(tokenDecimals)).toString();

  const [osQuote, uniQuote] = await Promise.all([
    onchainos.getQuote(creds, quoteAddr, TOKENS.USDC, oneUnit).catch(() => null),
    uniswap
      .getQuote(quoteAddr, TOKENS.USDC, oneUnit, "0x0000000000000000000000000000000000000001")
      .catch(() => null),
  ]);

  const candidates: Array<{ priceUsd: number; source: "onchainos" | "uniswap" }> = [];
  if (osQuote && osQuote.toAmount && osQuote.toAmount !== "0") {
    const usdc = Number(osQuote.toAmount) / 1e6;
    if (usdc > 0) candidates.push({ priceUsd: usdc, source: "onchainos" });
  }
  if (uniQuote && uniQuote.toAmount && uniQuote.toAmount !== "0") {
    const usdc = Number(uniQuote.toAmount) / 1e6;
    if (usdc > 0) candidates.push({ priceUsd: usdc, source: "uniswap" });
  }

  if (candidates.length === 0) return null;
  // Prefer the higher quote — that's what the user would actually get.
  candidates.sort((a, b) => b.priceUsd - a.priceUsd);
  return candidates[0];
}
