/**
 * Natural-language parser tests.
 *
 * Pure-function tests — no network, no credentials. Covers the matrix of
 * phrasings the skill advertises, plus the rejection paths (same token,
 * unsupported token, unparseable gibberish).
 *
 * Run with:  npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSwapIntent } from "../src/planner";
import { TOKENS, toMinimalUnits } from "../src/types";

const USDT = TOKENS.USDT.toLowerCase();
const USDC = TOKENS.USDC.toLowerCase();
const OKB = TOKENS.NATIVE_OKB.toLowerCase();
const WETH = TOKENS.WETH.toLowerCase();

function intent(s: string) {
  const r = parseSwapIntent(s);
  return { ...r.intent, warnings: r.warnings };
}

// ---------------- basic ----------------
test("parses 'swap 100 USDT for OKB'", () => {
  const i = intent("swap 100 USDT for OKB");
  assert.equal(i.fromToken.toLowerCase(), USDT);
  assert.equal(i.toToken.toLowerCase(), OKB);
  assert.equal(i.amount, "100");
  assert.equal(i.amountType, "exact");
  assert.equal(i.warnings.length, 0);
});

test("parses 'convert 0.5 OKB to USDT'", () => {
  const i = intent("convert 0.5 OKB to USDT");
  assert.equal(i.fromToken.toLowerCase(), OKB);
  assert.equal(i.toToken.toLowerCase(), USDT);
  assert.equal(i.amount, "0.5");
});

test("parses 'sell 50 USDT for WETH'", () => {
  const i = intent("sell 50 USDT for WETH");
  assert.equal(i.fromToken.toLowerCase(), USDT);
  assert.equal(i.toToken.toLowerCase(), WETH);
});

test("parses '100 USDT to OKB' (no verb)", () => {
  const i = intent("100 USDT to OKB");
  assert.equal(i.fromToken.toLowerCase(), USDT);
  assert.equal(i.toToken.toLowerCase(), OKB);
  assert.equal(i.amount, "100");
});

test("parses 'trade 10 USDT for USDC'", () => {
  const i = intent("trade 10 USDT for USDC");
  assert.equal(i.fromToken.toLowerCase(), USDT);
  assert.equal(i.toToken.toLowerCase(), USDC);
});

// ---------------- slangy ----------------
test("parses 'flip 5 OKB to USDT'", () => {
  const i = intent("flip 5 OKB to USDT");
  assert.equal(i.fromToken.toLowerCase(), OKB);
  assert.equal(i.toToken.toLowerCase(), USDT);
});

test("parses 'yeet 100 USDT into OKB'", () => {
  const i = intent("yeet 100 USDT into OKB");
  assert.equal(i.fromToken.toLowerCase(), USDT);
  assert.equal(i.toToken.toLowerCase(), OKB);
});

test("parses 'ape 10 USDT into OKB'", () => {
  const i = intent("ape 10 USDT into OKB");
  assert.equal(i.amountType, "exact");
  assert.equal(i.amount, "10");
});

test("parses 'turn 50 USDT into OKB'", () => {
  const i = intent("turn 50 USDT into OKB");
  assert.equal(i.fromToken.toLowerCase(), USDT);
});

// ---------------- portions ----------------
test("parses 'swap half my USDT to OKB'", () => {
  const i = intent("swap half my USDT to OKB");
  assert.equal(i.amountType, "percentage");
  assert.equal(i.amount, "50");
});

test("parses 'swap all my WETH for USDT'", () => {
  const i = intent("swap all my WETH for USDT");
  assert.equal(i.amountType, "all");
});

test("parses 'swap my entire USDT balance to OKB'", () => {
  const i = intent("swap my entire USDT balance to OKB");
  assert.equal(i.amountType, "all");
});

test("parses '25% of my OKB to USDT'", () => {
  const i = intent("25% of my OKB to USDT");
  assert.equal(i.amountType, "percentage");
  assert.equal(i.amount, "25");
});

test("parses 'a quarter of my USDT to OKB'", () => {
  const i = intent("a quarter of my USDT to OKB");
  assert.equal(i.amountType, "percentage");
  assert.equal(i.amount, "25");
});

test("parses 'two thirds of my OKB for USDT'", () => {
  const i = intent("two thirds of my OKB for USDT");
  assert.equal(i.amountType, "percentage");
  assert.equal(i.amount, "66");
});

// ---------------- dollar ----------------
test("parses 'swap $5 worth of OKB to USDT'", () => {
  const i = intent("swap $5 worth of OKB to USDT");
  assert.equal(i.amountType, "dollar");
  assert.equal(i.amount, "5");
  assert.equal(i.fromToken.toLowerCase(), OKB);
});

test("parses '$20 of OKB to USDT'", () => {
  const i = intent("$20 of OKB to USDT");
  assert.equal(i.amountType, "dollar");
  assert.equal(i.amount, "20");
});

test("parses 'swap $100 of USDT to OKB'", () => {
  const i = intent("swap $100 of USDT to OKB");
  assert.equal(i.amountType, "dollar");
  assert.equal(i.amount, "100");
});

// ---------------- conditions ----------------
test("parses 'swap 100 USDT for OKB if price is below 50'", () => {
  const i = intent("swap 100 USDT for OKB if price is below 50");
  assert.ok(i.condition, "condition should exist");
  assert.equal(i.condition!.type, "price_below");
  assert.equal(i.condition!.targetPrice, 50);
});

test("parses 'swap 100 USDT to OKB when price is above 60'", () => {
  const i = intent("swap 100 USDT to OKB when price is above 60");
  assert.equal(i.condition!.type, "price_above");
  assert.equal(i.condition!.targetPrice, 60);
});

test("parses 'swap 50 USDT to OKB if OKB is below $45'", () => {
  const i = intent("swap 50 USDT to OKB if OKB is below $45");
  assert.equal(i.condition!.type, "price_below");
  assert.equal(i.condition!.targetPrice, 45);
});

test("parses 'swap 1 USDT to OKB if price above $55'", () => {
  const i = intent("swap 1 USDT to OKB if price above $55");
  assert.equal(i.condition!.type, "price_above");
  assert.equal(i.condition!.targetPrice, 55);
});

test("parses 'swap 100 USDT for OKB once price drops to 40'", () => {
  const i = intent("swap 100 USDT for OKB once price drops to 40");
  assert.equal(i.condition!.type, "price_below");
  assert.equal(i.condition!.targetPrice, 40);
});

// ---------------- buy-side ----------------
test("parses 'buy OKB with 100 USDT'", () => {
  const i = intent("buy OKB with 100 USDT");
  assert.equal(i.fromToken.toLowerCase(), USDT);
  assert.equal(i.toToken.toLowerCase(), OKB);
  assert.equal(i.amount, "100");
});

test("parses 'purchase OKB using 50 USDT'", () => {
  const i = intent("purchase OKB using 50 USDT");
  assert.equal(i.fromToken.toLowerCase(), USDT);
  assert.equal(i.toToken.toLowerCase(), OKB);
});

// ---------------- rejection paths ----------------
test("rejects same-token swap", () => {
  const i = intent("swap 100 USDT for USDT");
  assert.ok(i.warnings.some((w) => /same/i.test(w)));
});

test("rejects USDD (not on X Layer) with a helpful message", () => {
  const i = intent("swap 100 USDT for USDD");
  assert.ok(i.warnings.some((w) => /USDD/.test(w) && /USDT or USDC/.test(w)));
});

test("rejects gibberish", () => {
  const i = intent("make me rich please");
  assert.ok(i.warnings.length > 0);
});

// ---------------- aliases ----------------
test("recognises 'tether' as USDT", () => {
  const i = intent("swap 10 tether for OKB");
  assert.equal(i.fromToken.toLowerCase(), USDT);
});

test("recognises 'eth' as WETH", () => {
  const i = intent("swap 1 eth for USDT");
  assert.equal(i.fromToken.toLowerCase(), WETH);
});

// ---------------- decimal helper ----------------
test("toMinimalUnits: USDT (6dp) '1.5' -> '1500000'", () => {
  assert.equal(toMinimalUnits("1.5", TOKENS.USDT), "1500000");
});

test("toMinimalUnits: OKB (18dp) '0.5' -> '500000000000000000'", () => {
  assert.equal(toMinimalUnits("0.5", TOKENS.NATIVE_OKB), "500000000000000000");
});

test("toMinimalUnits: integer USDC '100' -> '100000000'", () => {
  assert.equal(toMinimalUnits("100", TOKENS.USDC), "100000000");
});
