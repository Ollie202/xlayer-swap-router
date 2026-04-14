// X Layer chain constants
export const XLAYER_CHAIN_ID = "196";
export const XLAYER_RPC_URL = "https://rpc.xlayer.tech";

// Common token addresses on X Layer
export const TOKENS = {
  NATIVE_OKB: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // Native gas token placeholder
  WOKB: "0xe538905cf8410324e03a5a23c1c177a474d59b2b",
  USDT: "0x1E4a5963aBFD975d8c9021ce480b42188849D41d",
  USDC: "0x74b7F16337b8972027F6196A17a631aC6dE26d22",
  WETH: "0x5A77f1443D16ee5761d310e38b62f77f726bC71c",
} as const;

// Decimals by token address (lowercased). Used to convert human-readable
// amounts into minimal units for DEX aggregator calls.
export const TOKEN_DECIMALS: Record<string, number> = {
  [TOKENS.NATIVE_OKB.toLowerCase()]: 18,
  [TOKENS.WOKB.toLowerCase()]: 18,
  [TOKENS.USDT.toLowerCase()]: 6,
  [TOKENS.USDC.toLowerCase()]: 6,
  [TOKENS.WETH.toLowerCase()]: 18,
};

/**
 * Convert a human-readable amount (e.g. "0.5") to minimal units
 * (e.g. "500000" for USDT with 6 decimals). Returns the string
 * unchanged if it already looks like an integer minimal-unit value
 * and no decimals are known.
 */
export function toMinimalUnits(humanAmount: string, tokenAddress: string): string {
  const decimals = TOKEN_DECIMALS[tokenAddress.toLowerCase()];
  if (decimals === undefined) {
    // Unknown token — assume caller already passed minimal units
    return humanAmount;
  }
  const [whole, frac = ""] = humanAmount.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = (whole + fracPadded).replace(/^0+(?=\d)/, "") || "0";
  return combined;
}

// OnchainOS API
export const OKX_API_BASE = "https://web3.okx.com/api/v6";

export interface OkxCredentials {
  apiKey: string;
  secretKey: string;
  passphrase: string;
}

export interface SwapRequest {
  fromToken: string;      // Token address or symbol
  toToken: string;        // Token address or symbol
  amount: string;         // Human-readable amount (e.g. "100")
  slippagePercent?: number; // Default 1%
  walletAddress: string;
}

export interface SwapQuote {
  source: "onchainos" | "uniswap";
  fromToken: string;
  toToken: string;
  fromAmount: string;         // In wei/smallest unit
  toAmount: string;           // In wei/smallest unit
  toAmountReadable: string;   // Human-readable output amount
  estimatedGas: string;
  priceImpact: string;
  routePath: string[];        // DEXes/pools used
}

export interface SwapResult {
  success: boolean;
  source: "onchainos" | "uniswap";
  txHash?: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  error?: string;
}

export interface RouteComparison {
  best: SwapQuote;
  all: SwapQuote[];
  savings: string; // How much more the best route gives vs the worst
}

// OnchainOS API response shape
export interface OkxApiResponse<T> {
  code: string;
  msg: string;
  data: T[];
}

export interface OkxQuoteData {
  toTokenAmount: string;
  estimateGasFee: string;
  priceImpactPercentage: string;
  dexRouterList: Array<{
    router: string;
    routerPercent: string;
    subRouterList: Array<{
      dexProtocol: Array<{ dexName: string; percent: string }>;
      fromToken: { tokenSymbol: string; tokenAddress: string };
      toToken: { tokenSymbol: string; tokenAddress: string };
    }>;
  }>;
}

export interface OkxSwapData {
  tx: {
    from: string;
    to: string;
    value: string;
    data: string;
    gasPrice: string;
    gasLimit: string;
  };
  routerResult: OkxQuoteData;
}

export interface OkxApproveData {
  data: string;
  dexContractAddress: string;
  gasLimit: string;
  gasPrice: string;
}
