import { SwapQuote, XLAYER_CHAIN_ID } from "./types";

// Uniswap Trading API base
const UNISWAP_API_BASE = "https://trade-api.gateway.uniswap.org/v1";

interface UniswapQuoteResponse {
  quote: {
    output: {
      amount: string;
      token: string;
    };
    input: {
      amount: string;
      token: string;
    };
    gasFeeEstimate: string;
    priceImpact: number;
    route: Array<{
      protocol: string;
      poolAddress: string;
      fee: string;
    }>;
  };
}

interface UniswapSwapResponse {
  swap: {
    to: string;
    from: string;
    value: string;
    data: string;
    gasLimit: string;
  };
  quote: UniswapQuoteResponse["quote"];
}

export async function getQuote(
  fromToken: string,
  toToken: string,
  amount: string,
  walletAddress: string
): Promise<SwapQuote | null> {
  try {
    const body = {
      type: "EXACT_INPUT",
      tokenInChainId: parseInt(XLAYER_CHAIN_ID),
      tokenOutChainId: parseInt(XLAYER_CHAIN_ID),
      tokenIn: fromToken,
      tokenOut: toToken,
      amount,
      swapper: walletAddress,
      slippageTolerance: 0.01,
    };

    const res = await fetch(`${UNISWAP_API_BASE}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      // Uniswap may not support X Layer — this is expected
      if (res.status === 404 || res.status === 400) {
        console.log("Uniswap: X Layer route not available for this pair");
        return null;
      }
      console.error(`Uniswap quote error: ${res.status} ${errText}`);
      return null;
    }

    const data = (await res.json()) as UniswapQuoteResponse;
    const q = data.quote;

    const routePath = q.route?.map(
      (r) => `Uniswap ${r.protocol} (pool: ${r.poolAddress.slice(0, 10)}...)`
    ) ?? ["Uniswap"];

    return {
      source: "uniswap",
      fromToken,
      toToken,
      fromAmount: amount,
      toAmount: q.output.amount,
      toAmountReadable: q.output.amount,
      estimatedGas: q.gasFeeEstimate || "0",
      priceImpact: (q.priceImpact ?? 0).toString(),
      routePath,
    };
  } catch (err) {
    console.error("Uniswap quote error:", err);
    return null;
  }
}

export async function getSwapTx(
  fromToken: string,
  toToken: string,
  amount: string,
  walletAddress: string,
  slippageTolerance: number = 0.01
): Promise<UniswapSwapResponse | null> {
  try {
    const body = {
      type: "EXACT_INPUT",
      tokenInChainId: parseInt(XLAYER_CHAIN_ID),
      tokenOutChainId: parseInt(XLAYER_CHAIN_ID),
      tokenIn: fromToken,
      tokenOut: toToken,
      amount,
      swapper: walletAddress,
      slippageTolerance,
    };

    const res = await fetch(`${UNISWAP_API_BASE}/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error(`Uniswap swap error: ${res.status} ${await res.text()}`);
      return null;
    }

    return (await res.json()) as UniswapSwapResponse;
  } catch (err) {
    console.error("Uniswap swap error:", err);
    return null;
  }
}
