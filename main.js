import fs from "fs";
import path from "path";
import { logToFile } from "./logger.js";
import {
  token_sell,
  token_buy,
  getBondingCurveAddress,
  getTokenHolders,
  getDataFromTx,
  getSplTokenBalance,
  checkTransactionStatus,
} from "./fuc.js";
import { EventEmitter } from "events";
import Client from "@triton-one/yellowstone-grpc";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { CommitmentLevel } from "@triton-one/yellowstone-grpc";
import dotenv from "dotenv";
import chalk from "chalk";
import { tOutPut } from "./parsingtransaction.js";
import { sendBuyAlert, sendSellAlert, sendBalanceAlert, sendErrorAlert } from "./alert.js";
import telegramController, { setBotState, getBotState, isBotRunning, updateBotRunningState } from "./telegram_controller.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
console.log(__dirname);
dotenv.config();
const buyAmount = process.env.BUY_AMOUNT;
const buyAmount2 = process.env.BUY2_AMOUNT;
const BUY_AMOUNT_PERCENTAGE = parseFloat(process.env.BUY_AMOUNT_PERCENTAGE) || null; // Percentage of target wallet's SOL change
const GRPC_ENDPOINT = process.env.GRPC_ENDPOINT;
const GRPCTOKEN = process.env.GRPCTOKEN;
const GRPCTOKEN1 = process.env.GRPCTOKEN1;
const MY_WALLET = process.env.PUB_KEY;



// In-memory blacklist cache for speed
let blacklistCache = null;
let blacklistCacheTime = 0;
const BLACKLIST_CACHE_DURATION = 5000; // 5 seconds cache

// In-memory token balance cache for speed
let tokenBalanceCache = new Map(); // tokenMint -> {balance, lastUpdate}
const TOKEN_BALANCE_CACHE_DURATION = 1000; // 1 second cache
let tokenBalanceUpdateInterval = null;



// Constants
const SOL_ADDRESS = "So11111111111111111111111111111111111111112";
const RAYDIUM_AUTH_ADDRESS = "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL";
const RAYDIUM_LAUNCHLAB_ADDRESS = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";
const RAYDIUM_LAUNUNCHPAD_ADDRESS = "WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh";
const TARGET_WALLET = [
 ""
];


// Enhanced cooldown logic to prevent spam buying same token
const GLOBAL_COOLDOWN_MS = 300; // Global cooldown between any buys
const TOKEN_COOLDOWN_MS = 300; // Specific cooldown for same token



export const sellingLocks = new Map(); // key = tokenMint, value = boolean

function utcNow() {
  return new Date().toISOString();
}

function createPortfolio() {
  // In-memory only, no file, no JSON, pure cache for speed
  const entries = new Map();

  function updateEntry(mint, changes, price, isBuy, decimals) {
    // grab or create the entry
    let entry = entries.get(mint) || {
      amount: 0,
      boughtPrice: 0,
      buyCount: 0,
      sellCount: 0,
      soldAmount: 0,
      decimals,
      firstUpdate: null,
      lastUpdate: null,
    };

    if (isBuy) {
      // ---- BUY ----------------------------------
      const newCost = price * changes;
      const oldCost = entry.boughtPrice * entry.amount;
      const newTotal = entry.amount + changes;

      entry.boughtPrice = newTotal > 0 ? (oldCost + newCost) / newTotal : 0;
      entry.buyCount++;
      if (entry.buyCount === 1) entry.firstUpdate = utcNow();
      entry.amount = newTotal;
    } else {
      // ---- SELL ---------------------------------
      entry.sellCount++;
      entry.soldAmount += Math.abs(changes);
      entry.amount = entry.amount + changes;
    }

    entry.lastUpdate = utcNow();

    entries.set(mint, entry);
    return entry;
  }

  function getEntry(mint) {
    const entry = entries.get(mint);
    if (!entry) return null;
    return entry;
  }

  function deleteEntry(mint) {
    entries.delete(mint);
  }

  return {
    updateEntry,
    getEntry,
    deleteEntry,
    entries,
  };
}


class TransactionMonitor extends EventEmitter {
  constructor(targetWallet) {
    super();
    this.client = new Client(GRPC_ENDPOINT, GRPCTOKEN);
    this.targetWallet = targetWallet;
    this.portfolio = createPortfolio();

    this.bots = new Map();
    this.status = new Set();
    this.isRunning = false;
    this.isBuying = false;
    this.lastBuyTimestamp = 0;
    this.pool_status = null;

    this.lastTokenBuyTimestamps = new Map(); // Track last buy timestamp for each token
    this.processingTokens = new Set(); // Track tokens currently being processed

    // Add status display interval
    this.statusDisplayInterval = null;
    this.pingInterval = null; // Track ping interval
  }

  // Add method to get running bot count
  getRunningBotCount() {
    return this.bots.size;
  }

  // Add method to show detailed bot status
  showBotStatus() {
    const runningCount = this.getRunningBotCount();

    if (runningCount > 0) {
      console.log(chalk.cyan(`[${utcNow()}] 🤖 Active Trading Bots: ${runningCount} <<<<<<<<<<<<`));
      for (const [tokenMint, bot] of this.bots.entries()) {
        const shortMint = tokenMint.slice(0, 4) + "..." + tokenMint.slice(-4);
        const pnlPercent = bot.pnl ? (bot.pnl * 100).toFixed(2) : "0.00";
        const topPnlPercent = bot.topPnL ? (bot.topPnL * 100).toFixed(2) : "0.00";
        const timeSinceBuy = bot.buyTimestamp ? Math.floor((Date.now() - bot.buyTimestamp) / 1000) : 0;
        const minPnlPercent = bot.minPnl ? (bot.minPnl * 100).toFixed(2) : "0.00";
        const stoplossPercent = bot.dynamicStoplossPnl ? (bot.dynamicStoplossPnl * 100).toFixed(2) : "0.00";
        const timeSinceLastTx = 0; // No longer tracking last transaction time
        const walletCount = bot.walletHistory ? bot.walletHistory.size : 0;

        // Calculate maximum strategy values for display
        const maxTrailingFactorPercent = bot.maxTrailingFactorValue ? (bot.maxTrailingFactorValue * 100).toFixed(2) : "0.00";
        const maxStopPercentagePercent = bot.maxStopPercentageValue ? (bot.maxStopPercentageValue * 100).toFixed(2) : "0.00";
        const maxTrailingFactorLevel = bot.maxTrailingFactorLevel ? bot.maxTrailingFactorLevel.toFixed(1) : "0.0";
        const maxStopPercentageLevel = bot.maxStopPercentageLevel ? bot.maxStopPercentageLevel.toFixed(1) : "0.0";

        // Improved stoploss status
        const improvedStoplossStatus = bot.minPnLBreached
          ? bot.pnlZeroAfterMinPnLBreach
            ? "🚨 IMPROVED STOPLOSS ACTIVE"
            : "⚠️ MinPnL BREACHED"
          : "";

        console.log(
          chalk.bgBlackBright.white(
            `   • ${shortMint} | PnL: ${pnlPercent}% | Top: ${topPnlPercent}% | MinPnL: ${minPnlPercent}% | StopLoss: ${stoplossPercent}% | MaxTrail: ${maxTrailingFactorPercent}%(${maxTrailingFactorLevel}x) | MaxStop: ${maxStopPercentagePercent}%(${maxStopPercentageLevel}x) | Time: ${timeSinceBuy}s | Wallets: ${walletCount} (${timeSinceLastTx}s ago) ${improvedStoplossStatus}`
          )
        );
      }
    }
  }

  // Add method to log debug information for all bots
  logAllBotsDebugInfo() {
    const runningCount = this.getRunningBotCount();
    if (runningCount === 0) {
      console.log(chalk.cyan(`[${utcNow()}] 📊 No active bots to debug`));
      return;
    }

    console.log(chalk.cyan(`[${utcNow()}] 🔍 DEBUGGING ALL BOTS (${runningCount} active)`));
    for (const [tokenMint, bot] of this.bots.entries()) {
      bot.logStrategyDebugInfo();
    }
  }

  // Add method to start periodic status display
  startStatusDisplay(intervalMs = 5000) {
    // Default: every 5 seconds
    if (this.statusDisplayInterval) {
      clearInterval(this.statusDisplayInterval);
    }

    this.statusDisplayInterval = setInterval(() => {
      this.showBotStatus();
    }, intervalMs);

    console.log(chalk.cyan(`[${utcNow()}] 📊 Status display started (every ${intervalMs / 1000}s)`));
  }

  // Add method to stop status display
  stopStatusDisplay() {
    if (this.statusDisplayInterval) {
      clearInterval(this.statusDisplayInterval);
      this.statusDisplayInterval = null;
      console.log(chalk.cyan(`[${utcNow()}] 📊 Status display stopped`));
    }
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Start status display
    this.startStatusDisplay(5000); // Show status every 5 seconds

    const args = this.buildSubscriptionArgs();
    const RETRY_DELAY = 1000;

    while (this.isRunning) {
      let stream;
      try {
        stream = await this.client.subscribe();

        // Setup handlers
        this.setupStreamHandlers(stream);

        await new Promise((resolve, reject) => {
          stream.write(args, (err) => {
            err ? reject(err) : resolve();
          });
        }).catch((err) => {
          console.error("Failed to send subscription request:", err);
          throw err;
        });

        // Start ping interval to keep stream alive
        this.startPingInterval(stream);

        // Wait for stream to close or error
        await new Promise((resolve) => {
          let settled = false;
          stream.on("error", (error) => {
            if (!settled) {
              settled = true;
              console.error(`[${utcNow()}] Stream Error3:`, error);
              resolve(); // Don't reject, just resolve to allow retry
            }
          });

          stream.on("end", () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          });
          stream.on("close", () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          });
        });

        // If we get here, the stream ended/errored, so retry after delay
        console.error(`[${utcNow()}] Stream ended or errored, retrying in 1 seconds...`);
        await new Promise((res) => setTimeout(res, RETRY_DELAY));
      } catch (error) {
        console.error(`[${utcNow()}] Stream error, retrying in 1 seconds...`, error);
        await new Promise((res) => setTimeout(res, RETRY_DELAY));
      }
    }
  }

  async stop() {
    this.isRunning = false;
    this.stopStatusDisplay();

    // Clear ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // Stop all running bots
    for (const [tokenMint, bot] of this.bots.entries()) {
      await bot.stop();
    }

    console.log(chalk.cyan(`[${utcNow()}] 🛑 TransactionMonitor stopped. Total bots stopped: ${this.bots.size}`));
  }

  buildSubscriptionArgs() {
    return {
      accounts: {},
      slots: {},
      transactions: {
        pump: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [this.targetWallet],
          accountExclude: [],
          accountRequired: [],
        },
      },
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      commitment: CommitmentLevel.PROCESSED,
    };
  }

  setupStreamHandlers(stream) {
    stream.on("data", this.handleTransaction.bind(this));
  }

  startPingInterval(stream) {
    // Clear any existing ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    // Create ping request
    const pingRequest = {
      accounts: {},
      slots: {},
      transactions: {},
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: { id: STREAM_PING_CONFIG.pingId },
    };

    // Start ping interval
    this.pingInterval = setInterval(async () => {
      if (!this.isRunning || !stream) {
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        return;
      }

      try {
        await new Promise((resolve, reject) => {
          stream.write(pingRequest, (err) => {
            if (err === null || err === undefined) {
              resolve();
            } else {
              reject(err);
            }
          });
        });
        // Optional: Log successful ping (uncomment for debugging)
        // console.log(chalk.cyan(`[${utcNow()}] [Monitor ${this.targetWallet.slice(0, 8)}...] Ping sent successfully`));
      } catch (error) {
        console.error(chalk.red(`[${utcNow()}] [Monitor ${this.targetWallet.slice(0, 8)}...] Ping failed:`, error));
        // If ping fails, the stream might be dead, so we should stop
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
      }
    }, STREAM_PING_CONFIG.interval);

    console.log(
      chalk.blue(
        `[${utcNow()}] [Monitor ${this.targetWallet.slice(0, 8)}...] Ping interval started (every ${STREAM_PING_CONFIG.interval / 1000}s)`
      )
    );
  }

  // Method to check if stream is healthy
  isStreamHealthy() {
    return this.isRunning && this.pingInterval;
  }
  
  async handleTransaction(data) {
    if (!data?.transaction?.transaction) return;
    // if (!this.isRunning) return;
    
    try {
      const transactionData = await this.processTransactionData(data);
      
      const starttime = Date.now();
      if (!transactionData) {
        console.log(chalk.cyan(`[${utcNow()}] ⚠️⚠️⚠️ No available transaction data parsed from transaction`));

        return;
      }

      let {
        tokenChanges,
        solChanges,
        isBuy,
        tokenMint,
        tokenDecimal,
        pairAddress,
        user,
        liquidity,
        coinCreator,
        signature,
        context,
        pool_status,
      } = transactionData;
      if (tokenChanges === 0) {
        console.log("token change is zero");
        return;
      }
      const price = Math.abs(solChanges / (tokenChanges * 10 ** (9 - tokenDecimal)));
      const shortTokenName = tokenMint ? tokenMint.slice(0, 6) + "..." : "unknown";

      // this.logTransactionDetails(
      //   tokenMint,
      //   isBuy,
      //   tokenDecimal,
      //   tokenChanges,
      //   solChanges,
      //   price,
      //   pairAddress,
      //   user,
      //   liquidity,
      //   pool_status,
      //   signature
      // );
      // Initial transaction type detection
      // if (!isBotRunning()) {
      //   console.log(chalk.cyan(`[${utcNow()}] Bot is stopped, ignoring buy signal for ${shortTokenName}`));
      //   return;
      // }
      if (isBuy) {
        // Prevent buy processing if bot is not running
        console.log(chalk.greenBright(`[${utcNow()}] 🟢 BUY transaction detected: ${shortTokenName} <<<---${user}`));
      } else {
        console.log(chalk.magenta(`[${utcNow()}] 🔴 SELL transaction detected: ${shortTokenName} <<<---${user}`));
        return;
      }

      if (user === MY_WALLET) {
        console.log(chalk.bgBlue.white(`[${utcNow()}] 🏠 MY WALLET transaction detected: ${shortTokenName} <<<---${user}`));
        
        if (!this.bots.has(tokenMint)) {
          // if (this.status.has(tokenMint)) {
            //   console.log(chalk.cyan(`[${utcNow()}] Token ${tokenMint} already processed, skipping.`));
            //   return;
            // }
            
            // this.status.add(tokenMint);
            console.log(chalk.bgGreen.black(`[${utcNow()}] 🌌🌌🌌Bot started for my transaction`));
            await this.portfolio.updateEntry(tokenMint, tokenChanges, price, isBuy, tokenDecimal);
            const bot = new TradingBot(tokenMint, this.portfolio, user, coinCreator);
            this.bots.set(tokenMint, bot);
            console.log(`[${utcNow()}] 🌌🌌🌌🌌Bot started for my transaction, will stop in ${starttime - Date.now()}ms`);
            bot.start();
          // const { holders, totalSupply, top10Percentage } = await getTokenHolders(tokenMint, pairAddress);
          // bot._appendCsvRow({
          //   time: utcNow(),
          //   token_address: tokenMint,
          //   token_liquidity: liquidity,
          //   holders: holders.length,
          //   top10Percentage: top10Percentage,
          //   pnl: (0 * 100).toFixed(2),
          //   amount: tokenChanges,
          //   price: price.toFixed(9),
          //   toppnl: (0 * 100).toFixed(2),
          //   minPnl: (0 * 100).toFixed(2),
          //   holding_time: 0,
          //   reason: "BUY",
          //   bought_price: price.toFixed(9),
          //   wallet_count: 0,
          //   time_since_last_tx: 0,
          // });

          // Only send buy alert if bot is running
          if (isBotRunning()) {
            await sendBuyAlert({
              tokenMint,
              amount: tokenChanges,
              price,
              txid: signature,
              reason: "first",
            });
          }

          bot.on("sellExecuted", ({ amount, pnl, price, solReceived }) => {
            console.log(
              chalk.green(`[${utcNow()}] 💰💰💰 Sell executed: ${amount} tokens, P&L: ${(pnl * 100).toFixed(2)}%, Price: ${price} SOL`)
            );
          });
          bot.on("stopped", () => {
            this.bots.delete(tokenMint);
            console.log(`[${utcNow()}] 🧹 Bot stopped and cleaned for ${tokenMint}`);
          });

          bot.on("sellError", ({ error, amount, pnl }) => {
            console.error(chalk.red(`[${utcNow()}] ❌ Sell error: ${error.message}`));
          });

          bot.on("error", (error) => {
            console.error(chalk.red(`[${utcNow()}] ❌ Bot error: ${error.message}`));
          });

        }
      } else {
        console.log(chalk.bgYellow.black(`[${utcNow()}] 📈 TARGET WALLET transaction detected: ${shortTokenName} <<<---${user}`));


        // const shouldBuy = await this.shouldBuyToken(tokenMint, pairAddress, liquidity, user);
        // if (!shouldBuy) {
        //   console.log(chalk.cyan(`[${utcNow()}] ❌ Should not buy ${tokenMint}`));
        //   return;
        // }

        const now = Date.now();

        // Check global cooldown (any token)
        if (now - this.lastBuyTimestamp < GLOBAL_COOLDOWN_MS) {
          console.log(chalk.cyan(`[${utcNow()}] Global cooldown active (${GLOBAL_COOLDOWN_MS}ms), skipping ${tokenMint}`));
          return;
        }

        // Check token-specific cooldown
        const lastBuyForToken = this.lastTokenBuyTimestamps.get(tokenMint) || 0;
        if (now - lastBuyForToken < TOKEN_COOLDOWN_MS) {
          console.log(chalk.cyan(`[${utcNow()}] Token cooldown active for ${tokenMint} (${TOKEN_COOLDOWN_MS}ms), skipping`));
          return;
        }

        // Check if we're already processing this token
        if (this.processingTokens.has(tokenMint)) {
          console.log(chalk.cyan(`[${utcNow()}] Already processing ${tokenMint}, skipping duplicate`));
          return;
        }

        // Mark token as being processed
        this.processingTokens.add(tokenMint);

        // Update timestamps
        this.lastBuyTimestamp = now;
        this.lastTokenBuyTimestamps.set(tokenMint, now);

        try {
          // Calculate dynamic buy amount based on percentage of target wallet's SOL change
          const dynamicBuyAmount = calculateDynamicBuyAmount(solChanges, BUY_AMOUNT_PERCENTAGE);
          const finalBuyAmount = dynamicBuyAmount !== null ? dynamicBuyAmount : buyAmount;
          
          console.log(chalk.cyan(`[${utcNow()}] 🎯 Using buy amount: ${finalBuyAmount} SOL (${dynamicBuyAmount !== null ? 'dynamic' : 'fixed'})`));

          const txid = await token_buy(tokenMint, finalBuyAmount, pool_status, context);

          console.log(chalk.bgGreen.black(`[${utcNow()}] ✅ Token buy executed for: ${tokenMint}`));
          console.log(chalk.bgGreen.black(`[${utcNow()}] txid: https://solscan.io/tx/${txid}`));





          // Reset buying flag and cleanup
          this.processingTokens.delete(tokenMint);
        } catch (buyError) {
          const errorMessage = buyError.message || buyError.toString();

          // Handle insufficient funds error
          if (errorMessage.includes("INSUFFICIENT_FUNDS")) {
            console.error(chalk.red(`[${utcNow()}] ❌ INSUFFICIENT FUNDS: Cannot buy ${tokenMint}`));
            console.error(chalk.red(`[${utcNow()}] 💰 Please add more SOL to your wallet to continue trading`));
            logToFile(chalk.red(`[${utcNow()}] ❌ INSUFFICIENT_FUNDS: Cannot buy ${tokenMint} - ${errorMessage}`));

            // Clean up the failed buy attempt
            this.processingTokens.delete(tokenMint);
            console.log(chalk.cyan(`[${utcNow()}] 🧹 Cleaned up failed buy attempt for ${tokenMint}`));

            return;
          }

          // Handle slippage errors
          if (errorMessage.includes("TooLittleSolReceived") || errorMessage.includes("slippage")) {
            console.error(chalk.cyan(`[${utcNow()}] ⚠️ SLIPPAGE ERROR: Price moved unfavorably for ${tokenMint}`));
            logToFile(chalk.cyan(`[${utcNow()}] ⚠️ SLIPPAGE ERROR: ${tokenMint} - ${errorMessage}`));
          }

          // Handle network/RPC errors
          else if (errorMessage.includes("429") || errorMessage.includes("rate limit")) {
            console.error(chalk.cyan(`[${utcNow()}] ⚠️ RATE LIMIT: RPC endpoint is rate limiting for ${tokenMint}`));
            logToFile(chalk.cyan(`[${utcNow()}] ⚠️ RATE LIMIT: ${tokenMint} - ${errorMessage}`));
          }

          // Handle transaction simulation errors
          else if (errorMessage.includes("Simulation failed") || errorMessage.includes("custom program error")) {
            console.error(chalk.red(`[${utcNow()}] ❌ TRANSACTION ERROR: Simulation failed for ${tokenMint}`));
            logToFile(chalk.red(`[${utcNow()}] ❌ TRANSACTION ERROR: ${tokenMint} - ${errorMessage}`));
          }

          // Handle other buy errors
          else {
            console.error(chalk.red(`[${utcNow()}] ❌ Token buy failed: ${errorMessage}`));
            logToFile(chalk.red(`[${utcNow()}] ❌ Token buy failed: ${tokenMint} - ${errorMessage}`));
          }

          // Clean up after any buy error
          // this.status.delete(tokenMint);
          this.processingTokens.delete(tokenMint);
          // console.log(chalk.cyan(`[${utcNow()}] 🧹 Cleaned up buy attempt for ${tokenMint}`));
        }
      }
    } catch (error) {
      console.error(`[${utcNow()}] Transaction processing error:`, error);
    }
  }

  async processTransactionData(data) {
    try {
      const result = await tOutPut(data);
      // console.log(JSON.stringify(result, null, 2));
      if (!result) {
        console.log(chalk.cyan(`[${utcNow()}] ⚠️ No available transaction data parsed from transaction`));
        // console.log(JSON.stringify(data, null, 2));
        return null;
      }

      let { tokenChanges, solChanges, isBuy, user, mint, pool, liquidity, coinCreator, signature, context, pool_status } = result;

      if (tokenChanges === undefined || solChanges === undefined || isBuy === undefined) {
        console.log(
          chalk.cyan(
            `[${utcNow()}] ⚠️ Missing required transaction data: tokenChanges=${tokenChanges}, solChanges=${solChanges}, isBuy=${isBuy}`
          )
        );
        return null;
      }
      // console.log("🎈🎈🎈result", result)
      let preTokenBalances = data?.transaction?.transaction?.meta?.preTokenBalances;
      let postTokenBalances = data?.transaction?.transaction?.meta?.postTokenBalances;
      if (data && data.meta && data.transaction) {
        preTokenBalances = data?.meta?.preTokenBalances;
        postTokenBalances = data?.meta?.postTokenBalances;
      }
      let tokenDecimal = 6;

      if (result.pool_status != "raydium") {
        //Pumpfun Pumpswap Raydium_LaunchLab Raydium_LaunchPad
        if (isBuy) {
          postTokenBalances.forEach((balance) => {
            if (balance.mint === SOL_ADDRESS) {
              if (
                result.pool_status == "raydium_launchlab" &&
                balance.owner !== RAYDIUM_LAUNCHLAB_ADDRESS &&
                balance.owner !== RAYDIUM_LAUNUNCHPAD_ADDRESS
              ) {
                user = balance.owner;
              }
            } else {
              tokenDecimal = balance.uiTokenAmount.decimals;
              mint = balance.mint;
              if (
                result.pool_status == "raydium_launchlab" &&
                balance.owner !== RAYDIUM_LAUNCHLAB_ADDRESS &&
                balance.owner !== RAYDIUM_LAUNUNCHPAD_ADDRESS
              ) {
                user = balance.owner;
              }
            }
          });
        } else {
          preTokenBalances.forEach((balance) => {
            if (balance.mint === SOL_ADDRESS) {
              if (
                result.pool_status == "raydium_launchlab" &&
                balance.owner !== RAYDIUM_LAUNCHLAB_ADDRESS &&
                balance.owner !== RAYDIUM_LAUNUNCHPAD_ADDRESS
              ) {
                user = balance.owner;
              }
            } else {
              tokenDecimal = balance.uiTokenAmount.decimals;
              mint = balance.mint;
              if (
                result.pool_status == "raydium_launchlab" &&
                balance.owner !== RAYDIUM_LAUNCHLAB_ADDRESS &&
                balance.owner !== RAYDIUM_LAUNUNCHPAD_ADDRESS
              ) {
                user = balance.owner;
              }
            }
          });
          postTokenBalances.forEach((balance) => {
            if (
              result.pool_status == "raydium_launchlab" &&
              balance.owner !== RAYDIUM_LAUNCHLAB_ADDRESS &&
              balance.owner !== RAYDIUM_LAUNUNCHPAD_ADDRESS
            ) {
              user = balance.owner;
            }
          });
        }
        // if (result.pool == null) {
        //   pool = await getBondingCurveAddress(mint);
        //   console.log(`[${utcNow()}] >>>>>>>>>>>>pumpfun`);
        //   this.pool_status = "pumpfun";
        // }

        if (!isBuy) {
          tokenChanges = -tokenChanges;
        }
      } else {
        //Raydium
        let post_sol;
        let pre_sol;
        let pre_token;
        let post_token;
        postTokenBalances.forEach((balance) => {
          if (balance.owner === RAYDIUM_AUTH_ADDRESS) {
            if (balance.mint === SOL_ADDRESS) {
              post_sol = balance.uiTokenAmount.amount || 0;
            } else {
              post_token = balance.uiTokenAmount.amount || 0;
              tokenDecimal = balance.uiTokenAmount.decimals;
              mint = balance.mint;
              // console.log(mint, user)
            }
          } else {
            if (balance.owner !== RAYDIUM_LAUNCHLAB_ADDRESS && balance.owner !== RAYDIUM_LAUNUNCHPAD_ADDRESS) {
              user = balance.owner;
            }
          }
        });

        preTokenBalances.forEach((balance) => {
          if (balance.owner === RAYDIUM_AUTH_ADDRESS) {
            if (balance.mint === SOL_ADDRESS) {
              pre_sol = balance.uiTokenAmount.amount || 0;
            } else {
              pre_token = balance.uiTokenAmount.amount || 0;
            }
          } else {
            if (balance.owner !== RAYDIUM_LAUNCHLAB_ADDRESS && balance.owner !== RAYDIUM_LAUNUNCHPAD_ADDRESS) {
              user = balance.owner;
            }
          }
        });
        tokenChanges = pre_token - post_token;
        solChanges = pre_sol - post_sol;
        if (tokenChanges > 0) {
          isBuy = true;
        } else {
          isBuy = false;
        }
        liquidity = (2 * pre_sol) / 10 ** 9;
        coinCreator = RAYDIUM_LAUNCHLAB_ADDRESS;
        // console.log("solchange:", solChanges)

        context = null;
      }
      console.log("😉😉😉User:", user);
      // console.log("😉pre:", preTokenBalances);
      // console.log("😉post:", postTokenBalances);

      return {
        tokenChanges,
        solChanges,
        isBuy,
        tokenMint: mint,
        tokenDecimal,
        pairAddress: pool,
        user,
        liquidity,
        coinCreator,
        signature,
        context,
        pool_status,
      };
    } catch (error) {
      console.error(`[${utcNow()}] Error processing transaction data:`, error);
      return null;
    }
  }

  logTransactionDetails(
    tokenMint,
    isBuy,
    tokenDecimal,
    tokenChanges,
    solChanges,
    price,
    pairAddress,
    user,
    liquidity,
    pool_status,
    signature
  ) {
    const walletType = user === MY_WALLET ? "MY_WALLET" : "TARGET_WALLET";
    console.log(chalk.bgYellowBright(`[${utcNow()}] ${walletType}`, user));
    console.log(`[${utcNow()}] signature:`, signature, "");
    console.log(`[${utcNow()}] pool_status:`, pool_status, "");
    console.log(`[${utcNow()}] mint:`, isBuy ? chalk.green(tokenMint) : chalk.red(tokenMint));
    console.log(`[${utcNow()}] Decimals`, tokenDecimal);
    console.log(`[${utcNow()}] tokenChanges:`, isBuy ? chalk.green(tokenChanges) : chalk.red(tokenChanges));
    console.log(
      `[${utcNow()}] solChanges:`,
      isBuy ? chalk.green((solChanges / 10 ** 9).toFixed(4)) : chalk.red((solChanges / 10 ** 9).toFixed(3))
    );
    console.log(`[${utcNow()}] pairAddress:`, isBuy ? chalk.green(pairAddress) : chalk.red(pairAddress));
    console.log(`[${utcNow()}] price:`, isBuy ? chalk.green(price) : chalk.red(price), "");
    console.log(`[${utcNow()}] liquidity:`, isBuy ? chalk.green(liquidity) : chalk.red(liquidity), "");
  }
  async shouldBuyToken(tokenMint, pairAddress, liquidity, user) {
    const { holders, totalSupply, top10Percentage } = await getTokenHolders(tokenMint, pairAddress);

    if (holders.length === 0 || totalSupply === 0) {
      console.log(`[${utcNow()}] ❌ No holders or zero supply for ${tokenMint}`);
      return false;
    }

    console.log(`[${utcNow()}] 👥 Holders: ${holders.length}, 🐋 Top10%: ${top10Percentage}%, liquidity:${liquidity}`);
    // // Save the holders/top10/liquidity info to a file inside a folder named by the wallet address.
    // try {
    //   const walletDir = `./wallets/${user}`;
    //   const fileName = `${walletDir}/info.txt`;
    //   let existingData = "";
    //   if (fs.existsSync(fileName)) {
    //     existingData = fs.readFileSync(fileName, "utf-8");
    //   }
    //   // Remove any previous entry for this tokenMint
    //   const lines = existingData.split("\n").filter((line) => !line.includes(`mint: ${tokenMint}`));
    //   // Add the new info for this tokenMint
    //   const infoText = `[${utcNow()}] mint: ${tokenMint}\n👥Holders: ${
    //     holders.length
    //   }  |  🐋Top10Percentage: ${top10Percentage}    |    Liquidity: ${liquidity}\n`;
    //   lines.push(infoText.trim());
    //   if (!fs.existsSync(walletDir)) {
    //     fs.mkdirSync(walletDir, { recursive: true });
    //   }
    //   fs.writeFileSync(fileName, lines.join("\n").trim() + "\n", { flag: "w" });
    // } catch (e) {
    //   console.error(`[${utcNow()}] Error saving token info for ${user}:`, e);
    // }

    const passed =
      holders.length > BUY_FILTER.minHolders &&
      holders.length < BUY_FILTER.maxHolders &&
      top10Percentage < BUY_FILTER.maxTop10Percentage &&
      liquidity > BUY_FILTER.minLiquidity &&
      liquidity < BUY_FILTER.maxLiquidity;

    if (passed) console.log(`[${utcNow()}] ✅ shouldBuy: TRUE for ${tokenMint}`);
    else console.log(`[${utcNow()}] ❌ shouldBuy: FALSE for ${tokenMint}`);
    return passed;
  }



  handleError(error) {
    console.error(`[${utcNow()}] Stream Error1:`, error);
    this.isRunning = false;
  }
}

// Add global function to show all bot counts
export function showAllBotCounts() {
  console.log(chalk.bgCyan.black(`[${utcNow()}] 🤖 GLOBAL BOT STATUS REPORT`));
  console.log(chalk.cyan(`[${utcNow()}] Total monitors: ${TARGET_WALLET.length}`));

  // Note: This would need access to monitor instances
  // For now, we'll add this functionality to the main function
}

export async function pump_geyser() {
  const monitors = TARGET_WALLET.map((wallet) => new TransactionMonitor(wallet));

  console.log(`[${utcNow()}] 🚦 Script started for ${TARGET_WALLET.length} wallets`);
  console.log(chalk.blue(`[${utcNow()}] 📱 Telegram notifications: ${process.env.TELEGRAM_BOT_TOKEN ? "✅ Enabled" : "❌ Disabled"}`));
  console.log(chalk.blue(`[${utcNow()}] 🤖 Telegram controller: ${process.env.TELEGRAM_BOT_TOKEN ? "✅ Enabled" : "❌ Disabled"}`));

  // Show initial blacklist status
  showBlacklistStatus();

  // Show initial cache status
  showAllCacheStatus();

  // Start token balance background updates
  startTokenBalanceUpdates();



  // Add clear wallet configuration logging
  console.log(chalk.bgCyan.black(`[${utcNow()}] 🏠 WALLET CONFIGURATION`));
  console.log(chalk.cyan(`[${utcNow()}] MY_WALLET: ${MY_WALLET} (Your wallet - starts trading bots for monitoring/selling)`));
  console.log(chalk.cyan(`[${utcNow()}] TARGET_WALLETS: ${TARGET_WALLET.length} wallets (Monitor for buying opportunities)`));
  TARGET_WALLET.forEach((wallet, index) => {
    console.log(chalk.cyan(`[${utcNow()}]   ${index + 1}. ${wallet}`));
  });
  console.log(chalk.bgCyan.black(`[${utcNow()}] 📊 TRANSACTION LOGIC`));
  console.log(chalk.cyan(`[${utcNow()}] 🏠 MY_WALLET transactions → Start trading bots to monitor and sell tokens`));
  console.log(chalk.cyan(`[${utcNow()}] 📈 TARGET_WALLET transactions → Attempt to buy tokens (follow their trades)`));

  // Function to start all monitors
  const startAllMonitors = async () => {
    try {
      await Promise.all(monitors.map((monitor) => monitor.start()));
      console.log(chalk.green(`[${utcNow()}] ✅ All monitors started successfully`));
      updateBotRunningState(true);
    } catch (error) {
      console.error(chalk.red(`[${utcNow()}] ❌ Error starting monitors:`, error));
      updateBotRunningState(false);
    }
  };

  // Function to stop all monitors
  const stopAllMonitors = async () => {
    try {
      await Promise.all(monitors.map((monitor) => monitor.stop()));
      console.log(chalk.green(`[${utcNow()}] ✅ All monitors stopped successfully`));
      updateBotRunningState(false);
    } catch (error) {
      console.error(chalk.red(`[${utcNow()}] ❌ Error stopping monitors:`, error));
    }
  };

  // Initialize Telegram controller with monitors and control functions
  setBotState({
    monitors,
    startFunction: startAllMonitors,
    stopFunction: stopAllMonitors,
  });





  // Add manual status check every 60 seconds
  const globalStatusInterval = setInterval(() => {
    let totalBots = 0;
    for (const monitor of monitors) {
      totalBots += monitor.getRunningBotCount();
    }
    console.log(
      chalk.bgBlue.white(
        `[${utcNow()}] 🌐 GLOBAL STATUS: ${totalBots} total bots running across ${monitors.length} monitors`
      )
    );
  }, 60000); // Every 60 seconds

  // Add manual trigger for immediate status check
  process.on("SIGUSR1", () => {
    console.log(chalk.bgYellow.black(`[${utcNow()}] 📊 MANUAL STATUS TRIGGER`));
    let totalBots = 0;
    for (const monitor of monitors) {
      const botCount = monitor.getRunningBotCount();
      totalBots += botCount;
      console.log(chalk.cyan(`[${utcNow()}] Monitor ${monitor.targetWallet.slice(0, 8)}...: ${botCount} bots`));
      monitor.showBotStatus();
    }
    console.log(chalk.bgGreen.black(`[${utcNow()}] 📈 TOTAL: ${totalBots} bots across all monitors`));
  });



  // Add manual trigger for strategy debug
  process.on("SIGUSR3", () => {
    console.log(chalk.bgMagenta.black(`[${utcNow()}] 🔍 MANUAL STRATEGY DEBUG TRIGGER`));
    for (const monitor of monitors) {
      monitor.logAllBotsDebugInfo();
    }
  });

  // Add manual trigger for blacklist status
  process.on("SIGUSR4", () => {
    console.log(chalk.bgYellow.black(`[${utcNow()}] 📋 MANUAL BLACKLIST STATUS TRIGGER`));
    showBlacklistStatus();
  });

  // Add manual trigger for token balance cache status
  process.on("SIGUSR5", () => {
    console.log(chalk.bgBlue.black(`[${utcNow()}] 💰 MANUAL TOKEN BALANCE CACHE STATUS TRIGGER`));
    showTokenBalanceCacheStatus();
  });



  // Export functions for Telegram controller
  global.startTradingBot = startAllMonitors;
  global.stopTradingBot = stopAllMonitors;

  try {
    // Start monitors initially
    await startAllMonitors();
    updateBotRunningState(true);
  } catch (error) {
    console.error(chalk.red(`[${utcNow()}] Error in pump_geyser:`, error));
    updateBotRunningState(false);
  } finally {
    clearInterval(globalStatusInterval);
  }
}



function showAllCacheStatus() {
  console.log(chalk.bgCyan.black(`[${utcNow()}] 📊 CACHE STATUS OVERVIEW`));
  
  // Show blacklist cache status
  showBlacklistStatus();
  
  // Show token balance cache status
  showTokenBalanceCacheStatus();
}

// Helper function to calculate dynamic buy amount based on percentage of target wallet's SOL change
function calculateDynamicBuyAmount(solChanges,BUY_AMOUNT_PERCENTAGE ) {
  // If BUY_AMOUNT_PERCENTAGE is not set, return null to use fixed amount
  if (BUY_AMOUNT_PERCENTAGE === null) {
    return null;
  }

  try {
    // Calculate the percentage-based amount
    const solChangesInSol = Math.abs(solChanges) / LAMPORTS_PER_SOL;
    const dynamicAmount = solChangesInSol * BUY_AMOUNT_PERCENTAGE;
    
    // Ensure minimum and maximum bounds for safety
    const minAmount = 0.0001; // Minimum 0.01 SOL
    const maxAmount = 0.5;  // Maximum 10 SOL
    
    const clampedAmount = Math.max(minAmount, Math.min(maxAmount, dynamicAmount));

    console.log(chalk.cyan(`[${utcNow()}] 💰 Dynamic Buy Amount Calculation:`));
    console.log(chalk.cyan(`   • Target SOL Change: ${solChangesInSol.toFixed(4)} SOL`));
    console.log(chalk.cyan(`   • Percentage: ${(BUY_AMOUNT_PERCENTAGE * 100).toFixed(1)}%`));
    console.log(chalk.cyan(`   • Calculated Amount: ${dynamicAmount.toFixed(4)} SOL`));
    console.log(chalk.cyan(`   • Final Amount (clamped): ${clampedAmount.toFixed(4)} SOL`));
    
    return clampedAmount;
  } catch (error) {
    console.error(chalk.red(`[${utcNow()}] ❌ Error calculating dynamic buy amount: ${error.message}`));
    return null; // Fall back to fixed amount
  }
}

// Add global function to show all bot counts
