import axios from "axios";
import { Keypair, Connection, LAMPORTS_PER_SOL, VersionedTransaction, SystemProgram, PublicKey, TransactionMessage, sendAndConfirmRawTransaction } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { readFile } from "fs/promises";
import { Wallet } from "@project-serum/anchor";
import dotenv from "dotenv";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import bs58 from "bs58";
import { getSplTokenBalance } from "./fuc.js";
import { logToFile } from "./logger.js";
dotenv.config();

// SWAP_METHOD: "0slot", "nozomi", "race", "solana"
const SWAP_METHOD = (process.env.SWAP_METHOD || "solana").toLowerCase();
const decodedPrivateKey = process.env.PRIVATE_KEY;
const NOZOMI_URL = process.env.NOZOMI_URL;
const NOZOMI_UUID = process.env.NOZOMI_UUID;
const nozomiConnection = new Connection(`${NOZOMI_URL}?c=${NOZOMI_UUID}`);

const NOZOMI_TIP_LAMPORTS = Number(process.env.NOZOMI_TIP_LAMPORTS || 200000);
const JITO_TIP_LAMPORTS = Number(process.env.JITO_TIP || 100000);
const PRIORITIZATION_FEE_LAMPORTS = Number(process.env.PRIORITIZATION_FEE_LAMPORTS || 10000);

const NOZOMI_TIP_ADDRESS = new PublicKey("TEMPaMeCRFAS9EKF53Jd6KpHxgL47uWLcpFArU1Fanq");

export const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;

export const decodePrivateKey = (secretKeyString) =>{
  try {
    // Try base58 first
    return bs58.decode(secretKeyString);
  } catch (error) {
    try {
      // Try base64
      return Buffer.from(secretKeyString, 'base64');
    } catch (base64Error) {
      try {
        // Try JSON array (for array format)
        const jsonArray = JSON.parse(secretKeyString);
        return new Uint8Array(jsonArray);
      } catch (jsonError) {
        throw new Error('Invalid private key format. Supported formats: base58, base64, or JSON array');
      }
    }
  }
}

export const loadwallet = async () => {
  const privateKey = decodedPrivateKey;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in environment variables");
  }
  try {
    const privateKeyBytes=decodePrivateKey(privateKey)
    const keypair = Keypair.fromSecretKey(privateKeyBytes);

    if (!keypair) {
      throw new Error("Failed to create Keypair from the provided private key");
    }

    const wallet = new Wallet(keypair);
    wallet.keypair = keypair;
    return wallet;
  } catch (error) {
    console.error("Error loading wallet:", error);
    throw error;
  }
};

export const rpc_connection = () => {
  return new Connection(process.env.RPC_URL, "confirmed");
};

const getResponse = async (tokenA, tokenB, amount, slippageBps, anchorWallet) => {
  const quoteResponse = (
    await axios.get(
      `https://quote-api.jup.ag/v6/quote?inputMint=${tokenA}&outputMint=${tokenB}&amount=${amount}&slippageBps=${slippageBps}`
    )
  ).data;

  // Build swap request body based on SWAP_METHOD
  let swapRequestBody = {
    quoteResponse,
    userPublicKey: anchorWallet.publicKey.toString(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
  };

  // Map SWAP_METHOD string to behavior
  if (SWAP_METHOD === "solana" || SWAP_METHOD === "0slot") {
    // Standard prioritization fee
    swapRequestBody.prioritizationFeeLamports = PRIORITIZATION_FEE_LAMPORTS;
  } else if (SWAP_METHOD === "race") {
    // JITO tip
    swapRequestBody.prioritizationFeeLamports = { jitoTipLamports: JITO_TIP_LAMPORTS };
  }
  // "nozomi" handled in executeTransaction

  const swapResponse = await axios.post(`https://quote-api.jup.ag/v6/swap`, swapRequestBody);
  return swapResponse.data;
};

const executeTransaction = async (connection, swapTransaction, anchorWallet) => {
  try {
    if (!anchorWallet?.keypair) {
      throw new Error("Invalid anchorWallet: keypair is undefined");
    }

    const transaction = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
    transaction.sign([anchorWallet.keypair]);

    let newMessage, newTransaction, rawTransaction, txid, timestart;
    let blockhash = await connection.getLatestBlockhash();

    if (SWAP_METHOD === "nozomi") {
      let message = transaction.message;
      let addressLookupTableAccounts = await loadAddressLookupTablesFromMessage(message, connection);
      let txMessage = TransactionMessage.decompile(message, { addressLookupTableAccounts });
      // Add Nozomi tip instruction
      let nozomiTipIx = SystemProgram.transfer({
        fromPubkey: anchorWallet.publicKey,
        toPubkey: NOZOMI_TIP_ADDRESS,
        lamports: NOZOMI_TIP_LAMPORTS,
      });
      txMessage.instructions.push(nozomiTipIx);

      newMessage = txMessage.compileToV0Message(addressLookupTableAccounts);
      newMessage.recentBlockhash = blockhash.blockhash;

      newTransaction = new VersionedTransaction(newMessage);
      newTransaction.sign([anchorWallet.keypair]);

      rawTransaction = newTransaction.serialize();
      timestart = Date.now();
      txid = await nozomiConnection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        maxRetries: 2,
      });

      console.log("Nozomi response: txid: %s", txid);
    } else {
      // Standard/JITO/0slot/solana/race: send via normal connection
      const currentUTC = new Date();
      rawTransaction = transaction.serialize();
      timestart = Date.now();
      txid = await sendAndConfirmRawTransaction(connection, Buffer.from(rawTransaction), {
        skipPreflight: false,
        maxRetries: 1,
      });

      console.log("Standard/JITO/0slot/solana/race response: txid: %s", txid);
      const endUTC = new Date();
      const timeTaken = endUTC.getTime() - currentUTC.getTime();
      console.log(`⏱️ confirm time taken: ${timeTaken}ms (${(timeTaken / 1000).toFixed(2)}s)`);
      return txid;
    }

  } catch (error) {
    console.error("Transaction execution error:", error);
    console.log(chalk.red("Transaction reconfirm after 1s!"));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};

async function loadAddressLookupTablesFromMessage(message, connection) {
  let addressLookupTableAccounts = [];
  for (let lookup of message.addressTableLookups) {
    let lutAccounts = await connection.getAddressLookupTable(lookup.accountKey);
    addressLookupTableAccounts.push(lutAccounts.value);
  }
  return addressLookupTableAccounts;
}

export const getBalance = async () => {
  const startTime = Date.now();
  const startUTC = new Date(startTime).toISOString();
  const connection = rpc_connection();
  const walletInstance = await loadwallet();
  const balance = await connection.getBalance(walletInstance.publicKey);
  const endTime = Date.now();
  const endUTC = new Date(endTime).toISOString();
  const diffMs = endTime - startTime;
  const diffSec = (diffMs / 1000).toFixed(3);
  console.log(`[${endUTC}] ( duration: ${diffMs}ms / ${diffSec}s) balance =>`, balance / LAMPORTS_PER_SOL, "SOL");
  return balance / LAMPORTS_PER_SOL;
};

export const swap = async (action, mint, amount) => {
  const SOL_ADDRESS = "So11111111111111111111111111111111111111112";
  const RETRY_DELAY = Number(process.env.RETRY_DELAY) || 1000; // fallback to 1s if not set

  try {
    const currentUTC = new Date();
    console.log(`⌛⌛⌚⌚Starting swap at ${currentUTC.toUTCString()} (${currentUTC.getTime()}ms)`);
    const connection = rpc_connection();
    const wallet = await loadwallet();

    // Determine tokenA and tokenB based on action and mint
    let tokenA, tokenB;
    if (action === "BUY") {
      tokenA = SOL_ADDRESS;
      tokenB = mint;
    } else if (action === "SELL") {
      tokenA = mint;
      tokenB = SOL_ADDRESS;
    } else {
      throw new Error(`Unknown action: ${action}`);
    }

    console.log(`Swapping ${amount} of ${tokenA} for ${tokenB}...`);
    let retryCount = 0;
    while (retryCount <= MAX_RETRIES) {
      try {
        console.log(`Attempt ${retryCount + 1}/${MAX_RETRIES + 1}`);
        // If this is a sell (tokenA is not SOL and tokenB is SOL), and retryCount > 1, check tokenA balance before proceeding
        if (
          retryCount > 1 &&
          tokenA !== SOL_ADDRESS &&
          tokenB === SOL_ADDRESS
        ) {
          const balance = await getSplTokenBalance(tokenA);
          console.log(`(Retry #${retryCount}) Current tokenA (${tokenA}) balance:`, balance, "Requested amount:", amount);
          if (balance <= 0) {
            console.log(`No balance for tokenA (${tokenA}) to sell. Aborting swap.`);
            return "stop";
          }
          if (amount > balance) {
            console.log(`Requested amount (${amount}) exceeds available balance (${balance}) for tokenA (${tokenA}). Adjusting amount to available balance.`);
            amount = balance;
          }
        }

        const startTime = Date.now();
        const quoteData = await getResponse(tokenA, tokenB, amount, process.env.SLIPPAGE_BPS || "50", wallet);
        const endTime = Date.now();
        console.log(chalk.blue(`getResponse took ${endTime - startTime}ms (${((endTime - startTime) / 1000).toFixed(2)}s)`));

        if (!quoteData?.swapTransaction) {
          throw new Error("Failed to get swap transaction data");
        }

        const startExecTime = Date.now();
        const txid = await executeTransaction(connection, quoteData.swapTransaction, wallet);
        const endExecTime = Date.now();
        console.log(
          chalk.blue(`executeTransaction took ${endExecTime - startExecTime}ms (${((endExecTime - startExecTime) / 1000).toFixed(2)}s)`)
        );

        if (!txid) {
          throw new Error("Transaction was not confirmed");
        }

        console.log(`--------------------------------------------------------\n
✌✌✌Swap successful! ${tokenA} for ${tokenB}`);
        console.log(`https://solscan.io/tx/${txid}\n`);
        const endUTC = new Date();
        const timeTaken = endUTC.getTime() - currentUTC.getTime();
        console.log(`⏱️ Total time taken: ${timeTaken}ms (${(timeTaken / 1000).toFixed(2)}s)`);

        return txid;
      } catch (error) {
        console.error(`Attempt ${retryCount + 1} failed:`, error.message);
        retryCount++;

        if (retryCount > MAX_RETRIES) {
          console.error(`Transaction failed after ${MAX_RETRIES + 1} attempts.`);
          throw error;
        }

        console.warn(`Retrying in ${RETRY_DELAY / 1000} seconds (${retryCount}/${MAX_RETRIES})...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      }
    }
  } catch (error) {
    console.error("Swap failed:", error.message);
    return null;
  }

  return null;
};
