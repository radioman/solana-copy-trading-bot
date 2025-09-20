# 🤖 Telegram Bot Controller Setup

This guide will help you set up the Telegram bot controller for your trading bot.

## 📋 Prerequisites

1. **Telegram Account**: You need a Telegram account
2. **Bot Token**: You need to create a Telegram bot and get its token
3. **Environment Variables**: Add the bot token to your `.env` file

## 🔧 Setup Steps

### Step 1: Create a Telegram Bot

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` to BotFather
3. Follow the instructions to create your bot:
   - Choose a name for your bot (e.g., "My Trading Bot")
   - Choose a username (must end with 'bot', e.g., "mytradingbot123_bot")
4. BotFather will give you a token like: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`

### Step 2: Add Token to Environment

Add your bot token to your `.env` file:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

### Step 3: Test the Bot

Run the test script to verify everything works:

```bash
node test_telegram.js
```

### Step 4: Start Your Bot

Start your trading bot as usual:

```bash
node index.js
```

## 📱 Using the Telegram Bot

### Commands

Send these commands to your bot:

- `/start` - Main control panel with buttons
- `/status` - Check bot status and balance
- `/start_bot` - Start the trading bot
- `/stop_bot` - Stop the trading bot
- `/balance` - Check wallet balance
- `/alerts` - Manage alert settings
- `/help` - Show help message

### Interactive Buttons

The bot provides interactive buttons for:

- 🚀 **Start Bot** - Start the trading bot
- 🛑 **Stop Bot** - Stop the trading bot
- 💰 **Check Balance** - View wallet balance
- 📊 **Bot Status** - View detailed status
- 🔔 **Alert Settings** - Configure notifications
- 📈 **Trading Stats** - View trading statistics

## 🔔 Alert Settings

You can control which notifications you receive:

- **Buy Alerts** - Notifications when tokens are bought
- **Sell Alerts** - Notifications when tokens are sold
- **Insufficient Funds Alerts** - Warnings when balance is low
- **Balance Alerts** - Regular balance updates
- **Error Alerts** - Error notifications

## 🛡️ Security Features

- **Balance Check**: Bot won't start if balance is insufficient
- **Remote Control**: Start/stop bot from anywhere
- **Status Monitoring**: Real-time status updates
- **Alert Management**: Customizable notifications

## 🚨 Troubleshooting

### Bot Not Responding

1. Check if `TELEGRAM_BOT_TOKEN` is set correctly
2. Verify the bot is running: `node test_telegram.js`
3. Make sure you're messaging the correct bot

### Permission Errors

1. Make sure you're the bot owner
2. Check if the bot token is valid
3. Restart the bot if needed

### Balance Not Updating

1. Check if the bot has permission to read your wallet
2. Verify the wallet address is correct
3. Check network connectivity

## 📞 Support

If you encounter issues:

1. Check the console logs for error messages
2. Verify your environment variables
3. Test with the test script first
4. Make sure your Telegram bot is active

## 🔄 Integration

The Telegram controller is fully integrated with your trading bot:

- **Real-time Control**: Start/stop bot remotely
- **Live Monitoring**: View status and balance
- **Smart Alerts**: Conditional notifications based on settings
- **Safety Checks**: Balance verification before starting

Enjoy controlling your trading bot from anywhere! 🚀 