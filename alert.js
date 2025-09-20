import TelegramBot from 'node-telegram-bot-api';
// import "dotenv/config";
import dotenv from "dotenv";
dotenv.config()

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const bot = BOT_TOKEN && BOT_TOKEN.length > 0
  ? new TelegramBot(BOT_TOKEN, { polling: false })
  : null;

function escapeMarkdown(text) {
  return String(text).replace(/[_*`\[]/g, '\\$&');
}

// Function to get alert settings from telegram controller
async function getAlertSettings() {
  try {
    // Import the telegram controller dynamically to avoid circular dependencies
    const telegramController = await import('./telegram_controller.js');
    return telegramController.getAlertSettings();
  } catch (error) {
    console.error('Error getting alert settings:', error);
    // Return default settings if telegram controller is not available
    return {
      buyAlerts: true,
      sellAlerts: true,
      insufficientFundsAlerts: true,
      balanceAlerts: true,
      errorAlerts: true
    };
  }
}

// Function to check if a specific alert type is enabled
async function isAlertEnabled(alertType) {
  try {
    const alertSettings = await getAlertSettings();
    return alertSettings[alertType] === true;
  } catch (error) {
    console.error(`Error checking ${alertType} alert setting:`, error);
    return true; // Default to enabled if there's an error
  }
}

/**
 * Sends a sell alert to a Telegram bot using MarkdownV2.
 * @param {Object} info - The sell info object.
 * @param {string} info.tokenMint - The token mint address.
 * @param {number} info.amount - The amount sold.
 * @param {number} info.pnl - The PnL at the time of sell.
 * @param {number} info.price - The price at the time of sell.
 * @param {string} [info.reason] - The reason for the sell (e.g., 'stoploss', 'topPnL', etc).
 * @param {string} [info.txid] - The transaction ID (optional).
 */
export async function sendSellAlert({ tokenMint, amount, toppnl, pnl, price, reason, txid }) {
  // Check if sell alerts are enabled
  const sellAlertsEnabled = await isAlertEnabled('sellAlerts');
  if (!sellAlertsEnabled) {
    console.log('Sell alerts are disabled, skipping alert');
    return;
  }

  console.log(BOT_TOKEN,CHAT_ID)
  if (!bot || !CHAT_ID) {
    console.error('Telegram bot token or chat ID not set in environment variables.');
    return;
  }

  const isPositive = pnl > 0;
  let message = (isPositive ? '🟢🟢🟢 *SELL ALERT* 🟢🟢🟢' : '🚨🚨🚨 *SELL ALERT* 🚨🚨🚨') + '\n';
  message += '*PnL:* ' + escapeMarkdown((pnl * 100).toFixed(2)) + '%\n';
  message += '*Token:* ' + '\`' + escapeMarkdown(tokenMint) + '\`\n';
  message += '[gmgn](https://gmgn.ai/token/' + escapeMarkdown(tokenMint) + ') | ';
  message += '*Amount:* ' + escapeMarkdown(amount) + '\n';
  message += '*TOP PnL:* ' + escapeMarkdown((toppnl * 100).toFixed(2)) + '%\n';
  message += '*Price:* ' + escapeMarkdown(price) + ' SOL\n';
  if (reason) message += '*Reason:* ' + '\`' + escapeMarkdown(reason) + '\`\n';
  if (txid) message += '[Tx: View on Solscan](https://solscan.io/tx/' + escapeMarkdown(txid) + ')\n';
  message += '*Time:* ' + escapeMarkdown(new Date().toLocaleString());

  try {
    await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log('Sell alert sent successfully');
  } catch (err) {
    console.error('Failed to send Telegram alert:', err?.response?.data || err.message);
  }
}

export async function sendmessage(message){
  try {
    await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Failed to send Telegram alert:', err?.response?.data || err.message);
  }
}

export async function sendBuyAlert({ tokenMint, amount, price, txid, reason }) {
  // Check if buy alerts are enabled
  const buyAlertsEnabled = await isAlertEnabled('buyAlerts');
  if (!buyAlertsEnabled) {
    console.log('Buy alerts are disabled, skipping alert');
    return;
  }

  if (!bot || !CHAT_ID) {
    console.error('Telegram bot token or chat ID not set in environment variables.');
    return;
  }

  let message = '🔵 *BUY ALERT* 🔵\n';
  if (reason === 'first') {
    message += '*Reason:* `1️⃣First Buy`\n';
  } else if (reason === 'second') {
    message += '*Reason:* `2️⃣Second Buy (Rapid Drop)`\n';
  } else if (reason) {
    message += '*Reason:* `' + escapeMarkdown(reason) + '`\n';
  }
  message += '*Token:* ' + '\`' + escapeMarkdown(tokenMint) + '\`\n';
  message += '[gmgn](https://gmgn.ai/token/' + escapeMarkdown(tokenMint) + ') | ';
  message += '*Amount:* ' + escapeMarkdown(amount) + '\n';
  message += '*Price:* ' + escapeMarkdown(price) + ' SOL\n';
  if (txid) message += '[Tx: View on Solscan](https://solscan.io/tx/' + escapeMarkdown(txid) + ')\n';
  message += '*Time:* ' + escapeMarkdown(new Date().toLocaleString());

  try {
    await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log('Buy alert sent successfully');
  } catch (err) {
    console.error('Failed to send Telegram alert:', err?.response?.data || err.message);
  }
}

export async function sendInsufficientFundsAlert({ currentBalance, limitBalance, walletAddress }) {
  // Check if insufficient funds alerts are enabled
  const insufficientFundsAlertsEnabled = await isAlertEnabled('insufficientFundsAlerts');
  if (!insufficientFundsAlertsEnabled) {
    console.log('Insufficient funds alerts are disabled, skipping alert');
    return;
  }

  if (!bot || !CHAT_ID) {
    console.error('Telegram bot token or chat ID not set in environment variables.');
    return;
  }

  let message = '🚨🚨🚨 *INSUFFICIENT FUNDS ALERT* 🚨🚨🚨\n';
  message += '*Status:* `🛑 BOT STOPPED`\n';
  message += '*Current Balance:* ' + escapeMarkdown(currentBalance.toFixed(4)) + ' SOL\n';
  message += '*Limit Balance:* ' + escapeMarkdown(limitBalance.toFixed(4)) + ' SOL\n';
  message += '*Wallet:* ' + '\`' + escapeMarkdown(walletAddress) + '\`\n';
  message += '*Action Required:* Add SOL to wallet to resume trading\n';
  message += '*Time:* ' + escapeMarkdown(new Date().toLocaleString());

  try {
    await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log('Insufficient funds alert sent successfully');
  } catch (err) {
    console.error('Failed to send insufficient funds Telegram alert:', err?.response?.data || err.message);
  }
}

// New function for balance alerts
export async function sendBalanceAlert({ currentBalance, walletAddress }) {
  // Check if balance alerts are enabled
  const balanceAlertsEnabled = await isAlertEnabled('balanceAlerts');
  if (!balanceAlertsEnabled) {
    console.log('Balance alerts are disabled, skipping alert');
    return;
  }

  if (!bot || !CHAT_ID) {
    console.error('Telegram bot token or chat ID not set in environment variables.');
    return;
  }

  let message = '💰 *BALANCE UPDATE* 💰\n';
  message += '*Current Balance:* ' + escapeMarkdown(currentBalance.toFixed(4)) + ' SOL\n';
  message += '*Wallet:* ' + '\`' + escapeMarkdown(walletAddress) + '\`\n';
  message += '*Time:* ' + escapeMarkdown(new Date().toLocaleString());

  try {
    await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log('Balance alert sent successfully');
  } catch (err) {
    console.error('Failed to send balance Telegram alert:', err?.response?.data || err.message);
  }
}

// New function for error alerts
export async function sendErrorAlert({ error, context }) {
  // Check if error alerts are enabled
  const errorAlertsEnabled = await isAlertEnabled('errorAlerts');
  if (!errorAlertsEnabled) {
    console.log('Error alerts are disabled, skipping alert');
    return;
  }

  if (!bot || !CHAT_ID) {
    console.error('Telegram bot token or chat ID not set in environment variables.');
    return;
  }

  let message = '⚠️ *ERROR ALERT* ⚠️\n';
  message += '*Error:* ' + escapeMarkdown(error.message || error) + '\n';
  if (context) message += '*Context:* ' + escapeMarkdown(context) + '\n';
  message += '*Time:* ' + escapeMarkdown(new Date().toLocaleString());

  try {
    await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log('Error alert sent successfully');
  } catch (err) {
    console.error('Failed to send error Telegram alert:', err?.response?.data || err.message);
  }
}
