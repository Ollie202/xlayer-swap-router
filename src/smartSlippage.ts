import { Candlestick, TokenTradingInfo } from "./market";

export interface SlippageRecommendation {
  slippagePercent: number;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

/**
 * Dynamically calculate optimal slippage tolerance based on:
 * 1. Token liquidity relative to trade size
 * 2. Recent price volatility
 * 3. 24h price change momentum
 *
 * Returns a slippage recommendation instead of a static 1%.
 */
export function calculateSmartSlippage(
  tradeAmountUsd: number,
  tradingInfo: TokenTradingInfo | null,
  candles: Candlestick[]
): SlippageRecommendation {
  let baseSlippage = 0.5; // Start at 0.5%
  const reasons: string[] = [];

  // Factor 1: Liquidity ratio — how big is the trade vs available liquidity
  if (tradingInfo) {
    const liquidity = parseFloat(tradingInfo.liquidity);
    if (liquidity > 0) {
      const tradeToLiquidityRatio = tradeAmountUsd / liquidity;

      if (tradeToLiquidityRatio > 0.1) {
        // Trade is >10% of liquidity — very high impact
        baseSlippage += 3.0;
        reasons.push(`Trade is ${(tradeToLiquidityRatio * 100).toFixed(1)}% of pool liquidity — high price impact expected`);
      } else if (tradeToLiquidityRatio > 0.01) {
        // Trade is 1-10% of liquidity — moderate impact
        baseSlippage += 1.0;
        reasons.push(`Trade is ${(tradeToLiquidityRatio * 100).toFixed(2)}% of pool liquidity — moderate impact`);
      } else {
        reasons.push(`Trade is ${(tradeToLiquidityRatio * 100).toFixed(3)}% of pool liquidity — minimal impact`);
      }
    } else {
      baseSlippage += 2.0;
      reasons.push("Liquidity data unavailable — adding safety margin");
    }

    // Factor 2: 24h price momentum
    const priceChange = Math.abs(parseFloat(tradingInfo.priceChange24H));
    if (priceChange > 10) {
      baseSlippage += 1.5;
      reasons.push(`High 24h price movement (${priceChange.toFixed(1)}%) — market is volatile`);
    } else if (priceChange > 5) {
      baseSlippage += 0.5;
      reasons.push(`Moderate 24h price movement (${priceChange.toFixed(1)}%)`);
    }
  }

  // Factor 3: Candlestick volatility
  if (candles.length >= 2) {
    const volatility = calculateCandleVolatility(candles);
    if (volatility > 5) {
      baseSlippage += 2.0;
      reasons.push(`Very high hourly volatility (${volatility.toFixed(2)}%) — prices swinging rapidly`);
    } else if (volatility > 2) {
      baseSlippage += 0.75;
      reasons.push(`Elevated hourly volatility (${volatility.toFixed(2)}%)`);
    } else {
      reasons.push(`Low volatility (${volatility.toFixed(2)}%) — stable conditions`);
    }
  }

  // Clamp between 0.3% and 10%
  const finalSlippage = Math.min(10, Math.max(0.3, baseSlippage));

  // Confidence based on data availability
  let confidence: "high" | "medium" | "low";
  if (tradingInfo && candles.length >= 6) {
    confidence = "high";
  } else if (tradingInfo || candles.length >= 2) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return {
    slippagePercent: Math.round(finalSlippage * 100) / 100,
    confidence,
    reasoning: reasons.join(". ") + ".",
  };
}

function calculateCandleVolatility(candles: Candlestick[]): number {
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
 * Format slippage recommendation for display.
 */
export function formatSlippageRecommendation(rec: SlippageRecommendation): string {
  return [
    `=== Smart Slippage Analysis ===\n`,
    `  Recommended: ${rec.slippagePercent}%`,
    `  Confidence:  ${rec.confidence}`,
    `  Reasoning:   ${rec.reasoning}`,
  ].join("\n");
}
