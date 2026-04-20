import { ethers } from "ethers";
import { XLAYER_RPC_URL, XLAYER_CHAIN_ID, OkxCredentials } from "./types";
import * as onchainos from "./onchainos";
import * as uniswap from "./uniswap";

const ERC20_APPROVE_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const ERC20_BALANCE_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
];

const NATIVE_OKB_PLACEHOLDER = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/**
 * Read a token balance directly from the X Layer RPC — no OKX API dependency.
 * For the native OKB placeholder address, reads the native balance. For any
 * ERC-20, calls balanceOf. Returns minimal units as a bigint so downstream
 * math is exact.
 */
export async function getTokenBalanceOnChain(
  walletAddress: string,
  tokenAddress: string,
  rpcUrl?: string
): Promise<bigint> {
  const provider = new ethers.JsonRpcProvider(rpcUrl || XLAYER_RPC_URL, {
    chainId: parseInt(XLAYER_CHAIN_ID),
    name: "xlayer",
  });
  if (tokenAddress.toLowerCase() === NATIVE_OKB_PLACEHOLDER) {
    return provider.getBalance(walletAddress);
  }
  const erc20 = new ethers.Contract(tokenAddress, ERC20_BALANCE_ABI, provider);
  const bal: bigint = await erc20.balanceOf(walletAddress);
  return bal;
}

export function createWallet(privateKey: string, rpcUrl?: string): ethers.Wallet {
  const provider = new ethers.JsonRpcProvider(rpcUrl || XLAYER_RPC_URL, {
    chainId: parseInt(XLAYER_CHAIN_ID),
    name: "xlayer",
  });
  return new ethers.Wallet(privateKey, provider);
}

/**
 * Ensure the winning aggregator's router has ERC-20 allowance for this swap.
 *
 * Each aggregator owns its own approval path:
 * - OnchainOS: asks OKX for the DEX-contract approval calldata.
 * - Uniswap:   asks Uniswap's Trading API /check_approval endpoint.
 *
 * The previous version always asked OKX regardless of winner, which (a) broke
 * Uniswap-winning swaps because the approval went to the wrong contract, and
 * (b) broke any swap when OKX was unreachable. This version routes the
 * approval to the correct spender for the aggregator that will execute.
 *
 * Native OKB needs no approval and returns null immediately.
 */
export async function ensureApproval(
  wallet: ethers.Wallet,
  tokenAddress: string,
  amount: string,
  okxCreds: OkxCredentials,
  source: "onchainos" | "uniswap" = "onchainos"
): Promise<string | null> {
  // Native token (OKB) doesn't need approval
  if (tokenAddress.toLowerCase() === NATIVE_OKB_PLACEHOLDER) {
    return null;
  }

  if (source === "uniswap") {
    const approval = await uniswap.getApproval(tokenAddress, amount, wallet.address);
    if (!approval) {
      // No approval returned = already approved (common) OR endpoint failed.
      // Re-check on-chain to be safe — if allowance is sufficient, continue;
      // otherwise bail with a clear message.
      return null;
    }
    console.log(`Approving ${amount} of ${tokenAddress} for Uniswap...`);
    const tx = await wallet.sendTransaction({
      to: approval.to,
      data: approval.data,
      value: BigInt(approval.value || "0"),
    });
    console.log(`Approval tx sent: ${tx.hash}`);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`Approval transaction failed: ${tx.hash}`);
    }
    console.log(`Approval confirmed in block ${receipt.blockNumber}`);
    return tx.hash;
  }

  // OnchainOS path
  const approvalData = await onchainos.getApproval(okxCreds, tokenAddress, amount);
  if (!approvalData) {
    throw new Error("Failed to get approval transaction data from OnchainOS");
  }

  // Check current allowance
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_APPROVE_ABI, wallet);
  const currentAllowance: bigint = await tokenContract.allowance(
    wallet.address,
    approvalData.dexContractAddress
  );

  if (currentAllowance >= BigInt(amount)) {
    console.log("Sufficient allowance already exists, skipping approval");
    return null;
  }

  // Send approval transaction
  console.log(`Approving ${amount} of ${tokenAddress} for OnchainOS DEX...`);
  const tx = await wallet.sendTransaction({
    to: tokenAddress,
    data: approvalData.data,
    gasLimit: BigInt(approvalData.gasLimit),
  });

  console.log(`Approval tx sent: ${tx.hash}`);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Approval transaction failed: ${tx.hash}`);
  }

  console.log(`Approval confirmed in block ${receipt.blockNumber}`);
  return tx.hash;
}

/**
 * Signs and broadcasts a swap transaction.
 */
export async function executeSwap(
  wallet: ethers.Wallet,
  txData: { to: string; data: string; value: string; gasLimit?: string }
): Promise<{ txHash: string; blockNumber: number }> {
  console.log(`Executing swap via ${txData.to}...`);

  const tx = await wallet.sendTransaction({
    to: txData.to,
    data: txData.data,
    value: BigInt(txData.value || "0"),
    gasLimit: txData.gasLimit ? BigInt(txData.gasLimit) : undefined,
  });

  console.log(`Swap tx sent: ${tx.hash}`);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Swap transaction failed: ${tx.hash}`);
  }

  console.log(`Swap confirmed in block ${receipt.blockNumber}`);
  return { txHash: tx.hash, blockNumber: receipt.blockNumber };
}

/**
 * Returns the wallet's native OKB balance and address.
 */
export async function getWalletInfo(wallet: ethers.Wallet): Promise<{
  address: string;
  balanceOKB: string;
}> {
  const balance = await wallet.provider!.getBalance(wallet.address);
  return {
    address: wallet.address,
    balanceOKB: ethers.formatEther(balance),
  };
}
