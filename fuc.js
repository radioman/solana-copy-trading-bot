import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import chalk from "chalk";
const PUMP_FUN_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
import "dotenv/config";
import dotenv from "dotenv";
dotenv.config();
import { buy_pumpfun, buy_pumpswap, sell_pumpfun, sell_pumpswap } from "./swapsdk_0slot.js";
import { swap } from "./swap.js";
import { buy_raydium_CPMM, buy_raydium_launchpad, sell_raydium_CPMM, sell_raydium_launchpad } from "./swapRaydium.js";
const RPC_URL = process.env.RPC_URL;
const connection = new Connection(RPC_URL, "confirmed");

export const token_buy = async (mint, sol_amount, pool_status,  context) => {
 
  if (!mint) {
    throw new Error("mint is required and was not provided.");
  }
  const currentUTC = new Date();
  // const txid = await swap("BUY", mint, sol_amount * LAMPORTS_PER_SOL);
  let txid = "";
  console.log(chalk.green(`🟢BUY tokenAmount:::${sol_amount} pool_status: ${pool_status} `));
  if (pool_status == "pumpfun") {
    txid = await buy_pumpfun(mint, sol_amount * LAMPORTS_PER_SOL, context);
  } else if (pool_status == "pumpswap") {
    // txid = await swap("BUY", mint, sol_amount * LAMPORTS_PER_SOL);
    txid = await buy_pumpswap(mint, sol_amount * LAMPORTS_PER_SOL, context);
  } else if (pool_status == "raydium_launchlab") {
    txid = await buy_raydium_launchpad(mint, sol_amount * LAMPORTS_PER_SOL, context);
  } else {
    txid = await buy_raydium_CPMM(mint, sol_amount * LAMPORTS_PER_SOL);
  }
  const endUTC = new Date();
  const timeTaken = endUTC.getTime() - currentUTC.getTime();
  console.log(`⏱️ Total BUY time taken: ${timeTaken}ms (${(timeTaken / 1000).toFixed(2)}s)`);
  return txid;
};

export const token_sell = async (mint, tokenAmount, pool_status, isFull, context) => {
  try {
   
    if (!mint) {
      throw new Error("mint is required and was not provided.");
    }
    console.log(chalk.red(`🔴SELL tokenAmount:::${tokenAmount} pool_status: ${pool_status} `));

    const currentUTC = new Date();
    let txid = "";
    if (pool_status == "pumpfun") {
      txid = await sell_pumpfun(mint, tokenAmount, isFull, context);
    } else if (pool_status == "pumpswap") {
      txid = await sell_pumpswap(mint, tokenAmount, context, isFull);
      // txid = await swap("SELL", mint, tokenAmount);
    } else if (pool_status == "raydium_launchlab") {
      txid = await sell_raydium_launchpad(mint, tokenAmount, isFull);
    } else {
      txid = await sell_raydium_CPMM(mint, tokenAmount, isFull);
    }

    // const txid = await swap("SELL", mint, tokenAmount);
    const endUTC = new Date();
    const timeTaken = endUTC.getTime() - currentUTC.getTime();
    console.log(`⏱️ Total SELL time taken: ${timeTaken}ms (${(timeTaken / 1000).toFixed(2)}s)`);

    if (txid === "stop") {
      console.log(chalk.red(`[${new Date().toISOString()}] 🛑 Swap returned "stop" - no balance for ${mint}`));
      return "stop";
    }

    if (txid) {
      console.log(chalk.green(`Successfully sold ${tokenAmount} tokens : https://solscan.io/tx/${txid}`));
      return txid;
    }

    return null;
  } catch (error) {
    console.error("Error in token_sell:", error.message);
    if (error.response?.data) {
      console.error("API Error details:", error.response.data);
    }
    return null;
  }
};

export async function getBondingCurveAddress(mintAddress) {
  const tokenMint = new PublicKey(mintAddress);

  const [pairPDA] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), tokenMint.toBuffer()], PUMP_FUN_PROGRAM_ID);
  return pairPDA.toBase58();
}

export async function getTokenHolders(mintAddress, pairAddress) {
  try {
    const mintPubkey = new PublicKey(mintAddress);

    // Run both async calls in parallel
    const [mintInfoRes, tokenAccountsRes] = await Promise.all([
      connection.getParsedAccountInfo(mintPubkey),
      connection.getTokenLargestAccounts(mintPubkey),
    ]);

    // Extract total supply and owner (mint authority)
    const supply = mintInfoRes?.value?.data?.parsed?.info?.supply;

    const totalSupply = supply ? parseInt(supply) : 0;

    //   console.log("Total Supply:", totalSupply);

    if (!tokenAccountsRes.value) {
      console.log("No token accounts found");
      return { holders: [], top10Percentage: 0, totalSupply };
    }

    const holders = tokenAccountsRes.value

      .filter((account) => parseInt(account.amount) > 0)
      .map((account) => ({
        owner: account.address,
        amount: parseInt(account.amount),
      }));

    const filteredHolders = holders.filter((h) => h.owner !== pairAddress);

    // Get the top 10 excluding the mint authority
    const top10 = filteredHolders.slice(1, 11);
    //   console.log("Top 10 Holders (excluding owner):", top10);

    const top10Total = top10.reduce((sum, h) => sum + h.amount, 0);
    const top10Percentage = totalSupply > 0 ? (top10Total / totalSupply) * 100 : 0;

    return {
      holders: filteredHolders,
      totalSupply,
      top10Percentage: top10Percentage.toFixed(2),
    };
  } catch (error) {
    console.error("Error fetching token holders:", error);
    return { holders: [], top10Percentage: 0, totalSupply: 0 };
  }
}

// Add utility function to check transaction status
export const checkTransactionStatus = async (txid, maxRetries = 5) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔍 Attempt ${attempt}/${maxRetries}: Checking transaction ${txid}`);
      
      const status = await connection.getSignatureStatus(txid);
      console.log(`📊 Status:`, status?.value);
      
      if (status?.value) {
        const confirmationStatus = status.value.confirmationStatus;
        const confirmations = status.value.confirmations;
        
        console.log(`📈 Confirmation Status: ${confirmationStatus}, Confirmations: ${confirmations}`);
        
        if (confirmationStatus === 'finalized') {
          console.log(`✅ Transaction finalized successfully`);
          return { success: true, status: 'finalized', confirmations };
        } else if (confirmationStatus === 'confirmed') {
          console.log(`✅ Transaction confirmed`);
          return { success: true, status: 'confirmed', confirmations };
        } else if (confirmationStatus === 'processed') {
          console.log(`⏳ Transaction still processing...`);
          if (attempt < maxRetries) {
            const waitTime = Math.min(1000 * attempt, 5000); // Exponential backoff, max 5s
            console.log(`⏰ Waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }
      }
      
      // If we get here, transaction might not exist or failed
      if (attempt === maxRetries) {
        console.log(`❌ Transaction not found or failed after ${maxRetries} attempts`);
        return { success: false, status: 'not_found' };
      }
      
    } catch (error) {
      console.error(`❌ Error checking transaction status (attempt ${attempt}):`, error.message);
      if (attempt === maxRetries) {
        return { success: false, status: 'error', error: error.message };
      }
    }
  }
  
  return { success: false, status: 'timeout' };
};

export const getDataFromTx = async (txid) => {
  try {
    console.log(`🔍 Fetching transaction: ${txid}`);
    
    // First, try to get transaction status
    const status = await connection.getSignatureStatus(txid);
    console.log(`📊 Transaction status:`, status?.value);
    
    if (status?.value?.confirmationStatus === 'processed') {
      console.log(`⚠️ Transaction is still being processed, waiting...`);
      // Wait a bit for transaction to be confirmed
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    
    const tx = await connection.getParsedTransaction(txid, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    });

    if (!tx) {
      console.log(`❌ Transaction not found: ${txid}`);
      console.log(`🔍 Possible reasons:`);
      console.log(`   - Transaction is still being processed`);
      console.log(`   - Transaction failed and was not committed`);
      console.log(`   - RPC node doesn't have this transaction`);
      console.log(`   - Transaction is too old and pruned`);
      
      // Try with different commitment levels
      console.log(`🔄 Trying with 'finalized' commitment...`);
      const txFinalized = await connection.getParsedTransaction(txid, {
        maxSupportedTransactionVersion: 0,
        commitment: 'finalized'
      });
      
      if (txFinalized) {
        console.log(`✅ Transaction found with 'finalized' commitment`);
        return txFinalized;
      }
      
      return null;
    }

    console.log(`✅ Transaction found successfully`);
    return tx;
  } catch (error) {
    console.error(`❌ Error fetching transaction ${txid}:`, error.message);
    console.error(`🔍 Error details:`, error);
    
    // Check if it's a specific error type
    if (error.message.includes('not found')) {
      console.log(`💡 Transaction not found - it may still be processing or failed`);
    } else if (error.message.includes('timeout')) {
      console.log(`⏰ RPC timeout - try again later`);
    } else if (error.message.includes('rate limit')) {
      console.log(`🚫 Rate limited - wait before retrying`);
    }
    
    return null;
  }
};

export async function getMintFromPumpSwapPair(pairAddress) {
  const accountInfo = await connection.getAccountInfo(new PublicKey(pairAddress));
  if (!accountInfo?.data || accountInfo.data.length < 75) {
    console.log("Invalid or empty account data.");
    return null;
  }

  const buffer = accountInfo.data;

  // Use the correct offset (43) for the mint address
  const mintOffset = 43;
  const mintBytes = buffer.slice(mintOffset, mintOffset + 32);
  let mint;
  try {
    mint = new PublicKey(mintBytes).toBase58();
  } catch (e) {
    console.log("Failed to parse mint address at offset 43.");
    return null;
  }

  console.log(`✅ Pumpswap Mint Address: ${mint} (found at offset ${mintOffset})`);
  return mint;
}

export const getSplTokenBalance = async (mint) => {
  if (!mint) {
    console.log("🔄 Token balance error: Mint address is undefined or null.");
    throw new Error("Mint address is undefined or null.");
  }

  let mintPubkey;
  try {
    mintPubkey = new PublicKey(mint);
  } catch (err) {
    console.log("🔄 Token balance error: Invalid mint address provided.");
    throw err;
  }

  // const publicKey = getPublicKeyFromPrivateKey();
  const publicKey = process.env.PUB_KEY;
  const ata = await getAssociatedTokenAddress(mintPubkey, new PublicKey(publicKey));

  let account;
  try {
    account = await getAccount(connection, ata);
  } catch (err) {
    // Handle TokenAccountNotFoundError gracefully
    if (
      err.name === "TokenAccountNotFoundError" ||
      (err.message && (
        err.message.includes("Failed to find account") ||
        err.message.includes("Account does not exist") ||
        err.message.includes("could not find account")
      ))
    ) {
      // No account found, treat as zero balance
      // console.log("🔄 Token balance: Account not found, returning 0.");
      return null;
    }
    // If the error is related to an invalid mint, log and throw error
    if (err.message && err.message.includes("Invalid param")) {
      console.log("🔄 Token balance error: Invalid mint param.");
      throw err;
    }
    // Other errors
    console.log("🔄 Token balance error:", err.message || err);
    throw err;
  }

  return Number(account.amount); // Convert BigInt to Number
};

export const checkWalletBalance = async (requiredAmount = 0) => {
  try {
    const publicKey = process.env.PUB_KEY;
    if (!publicKey) {
      throw new Error("PUB_KEY not found in environment variables");
    }

    const walletPubkey = new PublicKey(publicKey);
    const startTime = Date.now();
    const balance = await connection.getBalance(walletPubkey);
    const endTime = Date.now();
    const timeTakenMs = endTime - startTime;
    console.log(chalk.gray(`[${new Date().toISOString()}] ⏱️ getBalance took ${timeTakenMs}ms (${(timeTakenMs / 1000).toFixed(2)}s)`));
    const balanceInSol = balance / LAMPORTS_PER_SOL;
    
    if (requiredAmount > 0) {
      const requiredWithFees = requiredAmount + 0.01; // Add 0.01 SOL for fees
      const hasSufficientFunds = balanceInSol >= requiredWithFees;
      
      console.log(chalk.blue(`[${new Date().toISOString()}] 💰 Wallet balance: ${balanceInSol.toFixed(4)} SOL`));
      console.log(chalk.blue(`[${new Date().toISOString()}] 💰 Required: ${requiredWithFees.toFixed(4)} SOL (including fees)`));
      console.log(chalk.blue(`[${new Date().toISOString()}] 💰 Sufficient funds: ${hasSufficientFunds ? '✅ YES' : '❌ NO'}`));
      
      return {
        balance: balanceInSol,
        required: requiredWithFees,
        hasSufficientFunds,
        publicKey: publicKey
      };
    }
    
    return {
      balance: balanceInSol,
      publicKey: publicKey
    };
  } catch (error) {
    console.error(chalk.red(`[${new Date().toISOString()}] ❌ Error checking wallet balance: ${error.message}`));
    throw error;
  }
};
