# 🚀 Solana Trading Bot Dashboard

A comprehensive, real-time dashboard for monitoring and manually trading with your Solana trading bot. Built with modern web technologies and real-time updates via WebSocket.

## ✨ Features

### 📊 Real-Time Monitoring
- **Live Status Updates**: Real-time connection status and bot health monitoring
- **Wallet Balance**: Current SOL balance with live updates
- **Portfolio Overview**: Total tokens held and portfolio value
- **Performance Metrics**: Buy/sell statistics, success rates, and profit tracking
- **System Uptime**: Bot uptime and last update timestamps

### 🎯 Manual Trading
- **Buy Tokens**: Manually purchase tokens with custom amounts and pool selection
- **Sell Tokens**: Sell specific amounts or entire positions
- **Pool Support**: Works with PumpFun, PumpSwap, Raydium LaunchLab, and Raydium CPMM
- **Quick Actions**: One-click sell buttons for immediate trading

### 📈 Portfolio Management
- **Token Tracking**: Real-time list of all bought tokens
- **Transaction History**: Complete history of all buy/sell operations
- **Pool Information**: Visual indicators for different DEX pools
- **Amount Management**: Track token amounts and buy prices

## 🛠️ Installation

### Prerequisites
- Node.js 16+ installed
- Your Solana trading bot running
- Environment variables configured

### Setup Steps

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment**
   Make sure your `.env` file contains:
   ```env
   RPC_URL=your_solana_rpc_url
   PUB_KEY=your_wallet_public_key
   DASHBOARD_PORT=3000  # Optional, defaults to 3000
   ```

3. **Start the Dashboard**
   ```bash
   npm run dashboard
   ```

4. **Access the Dashboard**
   Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

## 🎮 Usage Guide

### Dashboard Overview

#### Status Monitoring
- **Connection Status**: Green dot = connected, Yellow = connecting, Red = disconnected
- **Wallet Balance**: Shows current SOL balance
- **Total Tokens**: Number of active token positions
- **Portfolio Value**: Total value of all held tokens
- **System Uptime**: How long the bot has been running

#### Performance Metrics
- **Total Buys**: Count of successful buy transactions
- **Total Sells**: Count of successful sell transactions
- **Success Rate**: Percentage of successful transactions
- **Total Profit**: Cumulative profit/loss

### Manual Trading

#### Buying Tokens
1. Navigate to the "Manual Trading" section
2. Select "Buy Token" tab
3. Enter the token mint address
4. Specify the amount in SOL
5. Choose the appropriate pool (PumpFun, PumpSwap, Raydium, etc.)
6. Click "Buy Token"

#### Selling Tokens
1. Select "Sell Token" tab
2. Choose a token from your portfolio
3. Enter the amount to sell (or check "Sell Full Amount")
4. Click "Sell Token"

#### Quick Actions
- Use the "Sell All" button in the tokens table for immediate full position liquidation
- Refresh buttons update data in real-time

### Portfolio Management

#### Token Table
- **Token**: Shortened mint address with full address on hover
- **Amount**: Current token balance
- **Buy Price**: Original purchase price in SOL
- **Pool**: DEX pool used (color-coded badges)
- **Buy Time**: When the token was purchased
- **Actions**: Quick sell buttons

#### Transaction History
- **Type**: BUY/SELL operations
- **Transaction ID**: Shortened Solana transaction hash
- **Amount**: SOL or token amount
- **Timestamp**: When the transaction occurred
- **Status**: Success/failure indicators

## 🔧 Configuration

### Environment Variables
```env
# Required
RPC_URL=https://your-rpc-endpoint
PUB_KEY=your_wallet_public_key

# Optional
DASHBOARD_PORT=3000
```

### Dashboard Settings
The dashboard automatically:
- Updates every 10 seconds
- Connects to your trading bot via WebSocket
- Caches data for performance
- Handles connection reconnection

## 🚨 Troubleshooting

### Common Issues

#### Dashboard Won't Start
- Check if port 3000 is available
- Verify all dependencies are installed
- Ensure environment variables are set

#### No Data Displayed
- Verify bot is running and connected
- Check RPC endpoint connectivity
- Ensure wallet public key is correct

#### Trading Not Working
- Verify bot has sufficient SOL balance
- Check RPC endpoint response times
- Ensure pool selection matches token requirements

### Debug Mode
Enable console logging by opening browser developer tools:
- Press F12
- Check Console tab for connection status
- Monitor Network tab for API calls

## 🔒 Security Features

- **Input Validation**: All trading inputs are validated
- **Transaction Confirmation**: Confirmation dialogs for sell operations
- **Error Handling**: Comprehensive error messages and notifications
- **Rate Limiting**: Built-in protection against rapid-fire requests

## 📱 Responsive Design

The dashboard is fully responsive and works on:
- Desktop computers
- Tablets
- Mobile phones
- All modern browsers

## 🚀 Performance Features

- **Real-time Updates**: WebSocket-based live data
- **Efficient Caching**: Smart data caching for optimal performance
- **Optimized Rendering**: Minimal DOM updates for smooth experience
- **Background Sync**: Data refreshes automatically

## 🔄 Integration

The dashboard integrates seamlessly with your existing trading bot:
- Uses the same trading functions (`token_buy`, `token_sell`)
- Shares the same RPC connection
- Maintains consistent data state
- Supports all existing DEX integrations

## 📝 API Endpoints

The dashboard provides REST API endpoints:
- `GET /api/status` - Current dashboard status
- `GET /api/tokens` - List of bought tokens
- `GET /api/transactions` - Transaction history
- `GET /api/performance` - Performance metrics

## 🤝 Support

For issues or questions:
1. Check the troubleshooting section
2. Verify your configuration
3. Review console logs
4. Ensure all dependencies are up to date

## 🔮 Future Enhancements

Planned features:
- Advanced charting and analytics
- Portfolio performance graphs
- Risk management tools
- Multi-wallet support
- Mobile app version
- Telegram bot integration
- Email notifications

---

**Happy Trading! 🚀📈**
