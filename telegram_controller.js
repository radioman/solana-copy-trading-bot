import TelegramBot from 'node-telegram-bot-api';
import chalk from 'chalk';
import { checkWalletBalance } from './fuc.js';
import dotenv from 'dotenv';
dotenv.config();

// Utility function for UTC timestamp
function utcNow() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

const LIMIT_BALANCE = parseFloat(process.env.LIMIT_BALANCE) || 0.1; // Minimum balance threshold

// Bot state
let botState = {
  isRunning: false,
  monitors: [],
  startFunction: null,
  stopFunction: null,
  alertSettings: {
    buyAlerts: true,
    sellAlerts: true,
    insufficientFundsAlerts: true,
    balanceAlerts: true,
    errorAlerts: true
  },
  lastMessageId: null, // Track last message for updating buttons
  lastChatId: null,
  messageHistory: {} // Track message history per chat: { chatId: [messageIds] }
};

// Initialize bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Command list
const COMMANDS = {
  start: '🚀 Start the bot and show main control panel',
  stop: '🛑 Stop the bot',
  status: '📊 Check bot status and balance',
  balance: '💰 Check wallet balance',
  alerts: '🔔 Manage alert settings',
  help: '❓ Show this help message',
  stats: '📈 View trading statistics',
  settings: '⚙️ Bot configuration settings'
};

// Start command with enhanced interface and retry logic
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const maxRetries = 3;
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      console.log(`[${utcNow()}] 🚀 Start command received from chat ${chatId} (attempt ${attempt + 1}/${maxRetries})`);
      await sendMainControlPanel(chatId);
      console.log(`[${utcNow()}] ✅ Start command completed successfully`);
      return; // Success, exit retry loop
    } catch (error) {
      attempt++;
      console.error(`[${utcNow()}] ❌ Start command failed (attempt ${attempt}/${maxRetries}):`, error.message);
      
      if (attempt < maxRetries) {
        // Wait before retry with exponential backoff
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.log(`[${utcNow()}] ⏰ Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        // Final attempt failed, send error message
        try {
          await bot.sendMessage(chatId, `❌ Failed to load control panel after ${maxRetries} attempts.\n\nError: ${error.message}\n\nPlease try again in a few moments.`);
        } catch (sendError) {
          console.error(`[${utcNow()}] ❌ Could not send error message:`, sendError.message);
        }
      }
    }
  }
});

// Help command
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  await sendHelpMessage(chatId);
});

// Simple start command (fallback)
bot.onText(/\/start_simple/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const message = `
🤖 *Trading Bot Control Panel*

Status: ${botState.isRunning ? '🟢 Running' : '🔴 Stopped'}
Active Bots: ${botState.monitors.reduce((sum, monitor) => sum + monitor.getRunningBotCount(), 0)}
Balance: Checking...
Last Update: ${utcNow()}

*Commands:*
/start - Main control panel (with balance)
/start_simple - This simple panel
/status - Detailed status
/balance - Check balance
/alerts - Alert settings
/stats - Trading statistics
/help - Show all commands
    `;
    
    const keyboard = {
      inline_keyboard: [
        [{ 
          text: botState.isRunning ? '🛑 Stop Bot' : '🚀 Start Bot', 
          callback_data: botState.isRunning ? 'stop_bot' : 'start_bot' 
        }],
        [
          { text: '💰 Balance', callback_data: 'check_balance' },
          { text: '📊 Status', callback_data: 'bot_status' }
        ],
        [
          { text: '🔔 Alerts', callback_data: 'alerts_settings' },
          { text: '📈 Stats', callback_data: 'trading_stats' }
        ],
        [
          { text: '⚙️ Settings', callback_data: 'settings_panel' },
          { text: '🔄 Refresh', callback_data: 'refresh_panel' }
        ]
      ]
    };

    await bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
    
  } catch (error) {
    console.error(`[${utcNow()}] ❌ Simple start command failed:`, error.message);
    await bot.sendMessage(chatId, `❌ Failed to load simple panel.\n\nError: ${error.message}`);
  }
});

// Status command
bot.onText(/\/status/, async (msg) => {
  await sendStatusMessage(msg.chat.id);
});

// Start bot command
bot.onText(/\/start_bot/, async (msg) => {
  await handleStartBot(msg.chat.id);
});

// Stop bot command
bot.onText(/\/stop_bot/, async (msg) => {
  await handleStopBot(msg.chat.id);
});

// Balance command
bot.onText(/\/balance/, async (msg) => {
  await sendBalanceMessage(msg.chat.id);
});

// Alerts command
bot.onText(/\/alerts/, async (msg) => {
  await sendAlertsSettings(msg.chat.id);
});

// Stats command
bot.onText(/\/stats/, async (msg) => {
  await sendTradingStats(msg.chat.id);
});

// Settings command
bot.onText(/\/settings/, async (msg) => {
  await sendSettingsPanel(msg.chat.id);
});

// Callback handlers
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  try {
    switch (data) {
      case 'start_bot':
        await handleStartBot(chatId);
        break;
      case 'stop_bot':
        await handleStopBot(chatId);
        break;
      case 'check_balance':
        await sendBalanceMessage(chatId);
        break;
      case 'bot_status':
        await sendStatusMessage(chatId);
        break;
      case 'alerts_settings':
        await sendAlertsSettings(chatId);
        break;
      case 'trading_stats':
        await sendTradingStats(chatId);
        break;
      case 'settings_panel':
        await sendSettingsPanel(chatId);
        break;
      case 'refresh_panel':
        await sendMainControlPanel(chatId);
        break;
      case 'back_to_main':
        // Edit the current message to show main panel instead of sending new message
        await editMessageToMainPanel(chatId, query.message.message_id);
        break;
      case 'toggle_buy_alerts':
        botState.alertSettings.buyAlerts = !botState.alertSettings.buyAlerts;
        await sendAlertsSettings(chatId);
        break;
      case 'toggle_sell_alerts':
        botState.alertSettings.sellAlerts = !botState.alertSettings.sellAlerts;
        await sendAlertsSettings(chatId);
        break;
      case 'toggle_insufficient_funds_alerts':
        botState.alertSettings.insufficientFundsAlerts = !botState.alertSettings.insufficientFundsAlerts;
        await sendAlertsSettings(chatId);
        break;
      case 'toggle_balance_alerts':
        botState.alertSettings.balanceAlerts = !botState.alertSettings.balanceAlerts;
        await sendAlertsSettings(chatId);
        break;
      case 'toggle_error_alerts':
        botState.alertSettings.errorAlerts = !botState.alertSettings.errorAlerts;
        await sendAlertsSettings(chatId);
        break;
    }
    
    // Answer callback query to remove loading state
    await bot.answerCallbackQuery(query.id);
  } catch (error) {
    console.error('Telegram error:', error);
    await bot.answerCallbackQuery(query.id, { text: 'Error occurred' });
  }
});

// Function to track message in history
function trackMessage(chatId, messageId) {
  if (!botState.messageHistory[chatId]) {
    botState.messageHistory[chatId] = [];
  }
  botState.messageHistory[chatId].push(messageId);
  
  // Keep only last 5 messages per chat to prevent memory issues
  if (botState.messageHistory[chatId].length > 5) {
    botState.messageHistory[chatId] = botState.messageHistory[chatId].slice(-5);
  }
}

// Function to clean up old messages
async function cleanupOldMessages(chatId, keepLatest = 1) {
  try {
    if (!botState.messageHistory[chatId] || botState.messageHistory[chatId].length <= keepLatest) {
      return;
    }
    
    const messagesToDelete = botState.messageHistory[chatId].slice(0, -keepLatest);
    
    for (const messageId of messagesToDelete) {
      try {
        await bot.deleteMessage(chatId, messageId);
      } catch (deleteError) {
        // Ignore errors if message is already deleted or too old
        console.log(`Could not delete message ${messageId}: ${deleteError.message}`);
      }
    }
    
    // Update history to keep only the latest message
    botState.messageHistory[chatId] = botState.messageHistory[chatId].slice(-keepLatest);
    
  } catch (error) {
    console.error('Error cleaning up old messages:', error);
  }
}

// Function to send message and track it
async function sendTrackedMessage(chatId, message, options = {}) {
  try {
    console.log(`[${utcNow()}] 🧹 Cleaning up old messages for chat ${chatId}`);
    
    // Clean up old messages before sending new one
    try {
      await cleanupOldMessages(chatId, 0);
    } catch (cleanupError) {
      console.warn(`[${utcNow()}] ⚠️ Message cleanup failed:`, cleanupError.message);
      // Continue anyway, don't let cleanup failure stop the message
    }
    
    console.log(`[${utcNow()}] 📤 Sending message to chat ${chatId}`);
    const sentMessage = await bot.sendMessage(chatId, message, options);
    
    console.log(`[${utcNow()}] ✅ Message sent successfully (ID: ${sentMessage.message_id})`);
    trackMessage(chatId, sentMessage.message_id);
    return sentMessage;
    
  } catch (error) {
    console.error(`[${utcNow()}] ❌ Error sending tracked message:`, error.message);
    
    // Handle specific Telegram API errors
    if (error.message.includes('Forbidden')) {
      throw new Error('Bot is blocked by user or chat is private');
    } else if (error.message.includes('Bad Request')) {
      throw new Error('Invalid message format or chat ID');
    } else if (error.message.includes('Too Many Requests')) {
      throw new Error('Telegram rate limit exceeded - please wait');
    } else if (error.message.includes('Unauthorized')) {
      throw new Error('Bot token is invalid or expired');
    } else if (error.message.includes('Network Error')) {
      throw new Error('Network connection issue - please try again');
    }
    
    throw error;
  }
}

// Function to edit existing message to main panel
async function editMessageToMainPanel(chatId, messageId) {
  try {
    const balanceInfo = await checkWalletBalance();
    const totalBots = botState.monitors.reduce((sum, monitor) => sum + monitor.getRunningBotCount(), 0);

    const message = `
🤖 *Trading Bot Control Panel*

Status: ${botState.isRunning ? '🟢 Running' : '🔴 Stopped'}
Active Bots: ${totalBots}
Balance: ${balanceInfo?.balance.toFixed(4) || 'Unknown'} SOL
Last Update: ${utcNow()}

*Commands:*
/start - Main control panel
/status - Detailed status
/balance - Check balance
/alerts - Alert settings
/stats - Trading statistics
/help - Show all commands
    `;
    
    const keyboard = {
      inline_keyboard: [
        [{ 
          text: botState.isRunning ? '🛑 Stop Bot' : '🚀 Start Bot', 
          callback_data: botState.isRunning ? 'stop_bot' : 'start_bot' 
        }],
        [
          { text: '💰 Balance', callback_data: 'check_balance' },
          { text: '📊 Status', callback_data: 'bot_status' }
        ],
        [
          { text: '🔔 Alerts', callback_data: 'alerts_settings' },
          { text: '📈 Stats', callback_data: 'trading_stats' }
        ],
        [
          { text: '⚙️ Settings', callback_data: 'settings_panel' },
          { text: '🔄 Refresh', callback_data: 'refresh_panel' }
        ]
      ]
    };

    await bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });

  } catch (error) {
    console.error('Error editing message to main panel:', error);
    await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
}

// Main control panel with dynamic buttons
async function sendMainControlPanel(chatId) {
  try {
    console.log(`[${utcNow()}] 📊 Loading main control panel for chat ${chatId}`);
    
    // Check wallet balance with timeout and fallback
    let balanceInfo;
    try {
      balanceInfo = await Promise.race([
        checkWalletBalance(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Balance check timeout')), 10000)
        )
      ]);
      console.log(`[${utcNow()}] ✅ Balance check successful: ${balanceInfo?.balance?.toFixed(4) || 'Unknown'} SOL`);
    } catch (balanceError) {
      console.warn(`[${utcNow()}] ⚠️ Balance check failed:`, balanceError.message);
      balanceInfo = { balance: 'Unknown' };
    }
    
    const totalBots = botState.monitors.reduce((sum, monitor) => sum + monitor.getRunningBotCount(), 0);

    const message = `
🤖 *Trading Bot Control Panel*

Status: ${botState.isRunning ? '🟢 Running' : '🔴 Stopped'}
Active Bots: ${totalBots}
Balance: ${balanceInfo?.balance?.toFixed(4) || 'Unknown'} SOL
Last Update: ${utcNow()}

*Commands:*
/start - Main control panel
/status - Detailed status
/balance - Check balance
/alerts - Alert settings
/stats - Trading statistics
/help - Show all commands
    `;
    
    const keyboard = {
      inline_keyboard: [
        [{ 
          text: botState.isRunning ? '🛑 Stop Bot' : '🚀 Start Bot', 
          callback_data: botState.isRunning ? 'stop_bot' : 'start_bot' 
        }],
        [
          { text: '💰 Balance', callback_data: 'check_balance' },
          { text: '📊 Status', callback_data: 'bot_status' }
        ],
        [
          { text: '🔔 Alerts', callback_data: 'alerts_settings' },
          { text: '📈 Stats', callback_data: 'trading_stats' }
        ],
        [
          { text: '⚙️ Settings', callback_data: 'settings_panel' },
          { text: '🔄 Refresh', callback_data: 'refresh_panel' }
        ]
      ]
    };

    console.log(`[${utcNow()}] 📤 Sending main control panel message`);
    
    // Always send new tracked message (old messages will be cleaned up)
    const sentMessage = await sendTrackedMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
    
    botState.lastMessageId = sentMessage.message_id;
    botState.lastChatId = chatId;
    
    console.log(`[${utcNow()}] ✅ Main control panel sent successfully (message ID: ${sentMessage.message_id})`);

  } catch (error) {
    console.error(`[${utcNow()}] ❌ Error sending main control panel:`, error);
    
    // Try to send a simple error message without cleanup
    try {
      await bot.sendMessage(chatId, `❌ Failed to load control panel.\n\nError: ${error.message}\n\nPlease try /start again.`);
    } catch (sendError) {
      console.error(`[${utcNow()}] ❌ Could not send error message:`, sendError.message);
    }
    
    // Re-throw the error so the retry logic can handle it
    throw error;
  }
}

// Help message with command list
async function sendHelpMessage(chatId) {
  const message = `
❓ *Trading Bot Help*

*Available Commands:*

${Object.entries(COMMANDS).map(([cmd, desc]) => `/${cmd} - ${desc}`).join('\n')}

*Quick Actions:*
• Use the inline buttons for quick access
• Send /start to see the main control panel
• All commands work from any chat with the bot

*Tips:*
• The bot will automatically check your balance before starting
• You can control the bot remotely from anywhere
• Alerts can be customized in the alerts menu
• Statistics are updated in real-time
    `;

  await sendTrackedMessage(chatId, message, { parse_mode: 'Markdown' });
}

// Bot control functions with enhanced feedback
async function handleStartBot(chatId) {
  try {
    if (botState.isRunning) {
      await bot.sendMessage(chatId, '⚠️ Bot is already running!');
      return;
    }

    const balanceInfo = await checkWalletBalance();
    if (!balanceInfo || balanceInfo.balance < LIMIT_BALANCE) {
      await bot.sendMessage(chatId, `❌ Insufficient balance: ${balanceInfo?.balance.toFixed(4) || 'unknown'} SOL\n\nMinimum required: ${LIMIT_BALANCE} SOL`);
      return;
    }

    // Actually start the bot using the provided function
    if (botState.startFunction) {
      await botState.startFunction();
      console.log(chalk.green(`[${utcNow()}] 🤖 Bot started via Telegram`));
    } else {
      console.log(chalk.yellow(`[${utcNow()}] ⚠️ No start function available`));
    }

    botState.isRunning = true;
    
    const message = `
🚀 *Bot Started Successfully!*

Balance: ${balanceInfo.balance.toFixed(4)} SOL
Status: 🟢 Running
Start Time: ${utcNow()}
    `;

    await sendTrackedMessage(chatId, message, { parse_mode: 'Markdown' });
    
    // Update the main control panel
    await sendMainControlPanel(chatId);

  } catch (error) {
    console.error('Error starting bot:', error);
    await bot.sendMessage(chatId, `❌ Error starting bot: ${error.message}`);
    // Send error alert
    try {
      const { sendErrorAlert } = await import('./alert.js');
      await sendErrorAlert({ 
        error: error, 
        context: 'Bot start error' 
      });
    } catch (alertError) {
      console.error('Failed to send error alert:', alertError);
    }
  }
}

async function handleStopBot(chatId) {
  try {
    if (!botState.isRunning) {
      await bot.sendMessage(chatId, '⚠️ Bot is already stopped!');
      return;
    }

    // Actually stop the bot using the provided function
    if (botState.stopFunction) {
      await botState.stopFunction();
      console.log(chalk.green(`[${utcNow()}] 🤖 Bot stopped via Telegram`));
    } else {
      console.log(chalk.yellow(`[${utcNow()}] ⚠️ No stop function available`));
    }

    botState.isRunning = false;
    
    const message = `
🛑 *Bot Stopped Successfully!*

Status: 🔴 Stopped
Stop Time: ${utcNow()}
    `;

    await sendTrackedMessage(chatId, message, { parse_mode: 'Markdown' });
    
    // Update the main control panel
    await sendMainControlPanel(chatId);

  } catch (error) {
    console.error('Error stopping bot:', error);
    await bot.sendMessage(chatId, `❌ Error stopping bot: ${error.message}`);
    // Send error alert
    try {
      const { sendErrorAlert } = await import('./alert.js');
      await sendErrorAlert({ 
        error: error, 
        context: 'Bot stop error' 
      });
    } catch (alertError) {
      console.error('Failed to send error alert:', alertError);
    }
  }
}

async function sendStatusMessage(chatId) {
  try {
    const balanceInfo = await checkWalletBalance();
    const totalBots = botState.monitors.reduce((sum, monitor) => sum + monitor.getRunningBotCount(), 0);

    const message = `
📊 *Detailed Bot Status*

Status: ${botState.isRunning ? '🟢 Running' : '🔴 Stopped'}
Active Trading Bots: ${totalBots}
Monitors: ${botState.monitors.length}
Wallet Balance: ${balanceInfo?.balance.toFixed(4) || 'Unknown'} SOL
Minimum Required: ${LIMIT_BALANCE} SOL
Last Update: ${utcNow()}

*Alert Settings:*
Buy Alerts: ${botState.alertSettings.buyAlerts ? '✅' : '❌'}
Sell Alerts: ${botState.alertSettings.sellAlerts ? '✅' : '❌'}
Insufficient Funds: ${botState.alertSettings.insufficientFundsAlerts ? '✅' : '❌'}
Balance Alerts: ${botState.alertSettings.balanceAlerts ? '✅' : '❌'}
Error Alerts: ${botState.alertSettings.errorAlerts ? '✅' : '❌'}
    `;

    await sendTrackedMessage(chatId, message, { parse_mode: 'Markdown' });

  } catch (error) {
    await sendTrackedMessage(chatId, `❌ Error: ${error.message}`);
  }
}

async function sendBalanceMessage(chatId) {
  try {
    const balanceInfo = await checkWalletBalance();
    
    const message = `
💰 *Wallet Balance*

Current Balance: ${balanceInfo?.balance.toFixed(4) || 'Unknown'} SOL
Minimum Required: ${LIMIT_BALANCE} SOL
Status: ${balanceInfo?.balance >= LIMIT_BALANCE ? '✅ Sufficient' : '❌ Insufficient'}

Last Check: ${utcNow()}
    `;

    await sendTrackedMessage(chatId, message, { parse_mode: 'Markdown' });

  } catch (error) {
    await sendTrackedMessage(chatId, `❌ Error: ${error.message}`);
  }
}

async function sendAlertsSettings(chatId) {
  try {
    const message = `
🔔 *Alert Settings*

Configure which notifications you want to receive:

Buy Alerts: ${botState.alertSettings.buyAlerts ? '✅ Enabled' : '❌ Disabled'}
Sell Alerts: ${botState.alertSettings.sellAlerts ? '✅ Enabled' : '❌ Disabled'}
Insufficient Funds: ${botState.alertSettings.insufficientFundsAlerts ? '✅ Enabled' : '❌ Disabled'}
Balance Alerts: ${botState.alertSettings.balanceAlerts ? '✅ Enabled' : '❌ Disabled'}
Error Alerts: ${botState.alertSettings.errorAlerts ? '✅ Enabled' : '❌ Disabled'}

Tap any setting to toggle it.
    `;

    const keyboard = {
      inline_keyboard: [
        [{ text: `Buy Alerts: ${botState.alertSettings.buyAlerts ? '✅' : '❌'}`, callback_data: 'toggle_buy_alerts' }],
        [{ text: `Sell Alerts: ${botState.alertSettings.sellAlerts ? '✅' : '❌'}`, callback_data: 'toggle_sell_alerts' }],
        [{ text: `Insufficient Funds: ${botState.alertSettings.insufficientFundsAlerts ? '✅' : '❌'}`, callback_data: 'toggle_insufficient_funds_alerts' }],
        [{ text: `Balance Alerts: ${botState.alertSettings.balanceAlerts ? '✅' : '❌'}`, callback_data: 'toggle_balance_alerts' }],
        [{ text: `Error Alerts: ${botState.alertSettings.errorAlerts ? '✅' : '❌'}`, callback_data: 'toggle_error_alerts' }],
        [{ text: '🔙 Back to Main', callback_data: 'back_to_main' }]
      ]
    };

    await sendTrackedMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });

  } catch (error) {
    await sendTrackedMessage(chatId, `❌ Error: ${error.message}`);
  }
}

async function sendTradingStats(chatId) {
  try {
    const totalBots = botState.monitors.reduce((sum, monitor) => sum + monitor.getRunningBotCount(), 0);
    
    const message = `
📈 *Trading Statistics*

Active Bots: ${totalBots}
Monitors: ${botState.monitors.length}
Status: ${botState.isRunning ? '🟢 Running' : '🔴 Stopped'}

*Note:* Detailed trading statistics will be available as the bot runs and collects data.

Last Update: ${utcNow()}
    `;

    const keyboard = {
      inline_keyboard: [
        [{ text: '🔄 Refresh Stats', callback_data: 'trading_stats' }],
        [{ text: '🔙 Back to Main', callback_data: 'back_to_main' }]
      ]
    };

    await sendTrackedMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });

  } catch (error) {
    await sendTrackedMessage(chatId, `❌ Error: ${error.message}`);
  }
}

async function sendSettingsPanel(chatId) {
  try {
    const message = `
⚙️ *Bot Settings*

*Current Configuration:*
Minimum Balance: ${LIMIT_BALANCE} SOL
RPC URL: ${process.env.RPC_URL ? '✅ Set' : '❌ Not Set'}
Wallet: ${process.env.WALLET ? '✅ Set' : '❌ Not Set'}

*Environment Variables:*
- RPC_URL: Solana RPC endpoint
- WALLET: Your wallet address
- LIMIT_BALANCE: Minimum balance threshold
- TELEGRAM_BOT_TOKEN: Bot token (✅ Set)

Last Update: ${utcNow()}
    `;

    const keyboard = {
      inline_keyboard: [
        [{ text: '🔙 Back to Main', callback_data: 'back_to_main' }]
      ]
    };

    await sendTrackedMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });

  } catch (error) {
    await sendTrackedMessage(chatId, `❌ Error: ${error.message}`);
  }
}

// Export functions
export function setBotState(state) {
  if (!botState) {
    botState = {
      isRunning: false,
      monitors: [],
      startFunction: null,
      stopFunction: null,
      alertSettings: {
        buyAlerts: true,
        sellAlerts: true,
        insufficientFundsAlerts: true,
        balanceAlerts: true,
        errorAlerts: true
      },
      lastMessageId: null,
      lastChatId: null
    };
  }
  botState = { ...botState, ...state };
}

export function getBotState() {
  return botState;
}

export function isBotRunning() {
  return botState.isRunning;
}

export function updateBotRunningState(isRunning) {
  botState.isRunning = isRunning;
}

export function getAlertSettings() {
  return botState.alertSettings;
}

console.log(chalk.green(`[${utcNow()}] 🤖 Telegram controller initialized`));

export default bot;