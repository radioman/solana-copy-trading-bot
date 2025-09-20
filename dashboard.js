import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { token_buy, token_sell, getSplTokenBalance, checkWalletBalance } from './fuc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Solana connection
const RPC_URL = process.env.RPC_URL;
const connection = new Connection(RPC_URL, 'confirmed');
const MY_WALLET = process.env.PUB_KEY;

// In-memory storage for dashboard data
let dashboardData = {
  botStatus: 'running',
  walletBalance: 0,
  totalTokens: 0,
  totalValue: 0,
  recentTransactions: [],
  boughtTokens: new Map(),
  performance: {
    totalBuys: 0,
    totalSells: 0,
    totalProfit: 0,
    successRate: 0
  },
  systemInfo: {
    uptime: 0,
    lastUpdate: new Date(),
    version: '1.0.0'
  }
};

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Dashboard client connected');
  
  // Send initial data
  socket.emit('dashboardData', dashboardData);
  
  socket.on('disconnect', () => {
    console.log('Dashboard client disconnected');
  });
  
  // Handle manual buy request
  socket.on('manualBuy', async (data) => {
    try {
      const { tokenMint, amount, poolStatus } = data;
      console.log(`Manual buy request: ${tokenMint}, Amount: ${amount} SOL, Pool: ${poolStatus}`);
      
      // Execute buy
      const txid = await token_buy(tokenMint, amount, poolStatus, {});
      
      if (txid) {
        // Add to bought tokens
        dashboardData.boughtTokens.set(tokenMint, {
          mint: tokenMint,
          amount: amount,
          buyPrice: amount,
          buyTime: new Date(),
          poolStatus: poolStatus,
          txid: txid,
          status: 'bought'
        });
        
        dashboardData.performance.totalBuys++;
        dashboardData.recentTransactions.unshift({
          type: 'BUY',
          tokenMint: tokenMint,
          amount: amount,
          txid: txid,
          timestamp: new Date(),
          status: 'success'
        });
        
        // Update dashboard
        updateDashboard();
        socket.emit('buyResult', { success: true, txid: txid });
      } else {
        socket.emit('buyResult', { success: false, error: 'Buy transaction failed' });
      }
    } catch (error) {
      console.error('Manual buy error:', error);
      socket.emit('buyResult', { success: false, error: error.message });
    }
  });
  
  // Handle manual sell request
  socket.on('manualSell', async (data) => {
    try {
      const { tokenMint, amount, isFull } = data;
      const tokenData = dashboardData.boughtTokens.get(tokenMint);
      
      if (!tokenData) {
        socket.emit('sellResult', { success: false, error: 'Token not found in bought tokens' });
        return;
      }
      
      console.log(`Manual sell request: ${tokenMint}, Amount: ${amount}, Full: ${isFull}`);
      
      // Execute sell
      const txid = await token_sell(tokenMint, amount, tokenData.poolStatus, isFull, {});
      
      if (txid && txid !== 'stop') {
        // Update token data
        if (isFull) {
          dashboardData.boughtTokens.delete(tokenMint);
        } else {
          tokenData.amount -= amount;
        }
        
        dashboardData.performance.totalSells++;
        dashboardData.recentTransactions.unshift({
          type: 'SELL',
          tokenMint: tokenMint,
          amount: amount,
          txid: txid,
          timestamp: new Date(),
          status: 'success'
        });
        
        // Update dashboard
        updateDashboard();
        socket.emit('sellResult', { success: true, txid: txid });
      } else {
        socket.emit('sellResult', { success: false, error: 'Sell transaction failed' });
      }
    } catch (error) {
      console.error('Manual sell error:', error);
      socket.emit('sellResult', { success: false, error: error.message });
    }
  });
  
  // Handle refresh request
  socket.on('refreshData', async () => {
    await refreshDashboardData();
    socket.emit('dashboardData', dashboardData);
  });
});

// API Routes
app.get('/api/status', (req, res) => {
  res.json(dashboardData);
});

app.get('/api/tokens', (req, res) => {
  const tokens = Array.from(dashboardData.boughtTokens.values());
  res.json(tokens);
});

app.get('/api/transactions', (req, res) => {
  res.json(dashboardData.recentTransactions);
});

app.get('/api/performance', (req, res) => {
  res.json(dashboardData.performance);
});

// Dashboard update function
function updateDashboard() {
  dashboardData.totalTokens = dashboardData.boughtTokens.size;
  dashboardData.systemInfo.lastUpdate = new Date();
  
  // Emit to all connected clients
  io.emit('dashboardData', dashboardData);
}

// Refresh dashboard data
async function refreshDashboardData() {
  try {
    // Update wallet balance
    if (MY_WALLET) {
      const balance = await checkWalletBalance(MY_WALLET);
      dashboardData.walletBalance = balance;
    }
    
    // Update system info
    dashboardData.systemInfo.uptime = process.uptime();
    
    // Calculate total value (simplified)
    let totalValue = 0;
    for (const [_, tokenData] of dashboardData.boughtTokens) {
      totalValue += tokenData.amount;
    }
    dashboardData.totalValue = totalValue;
    
    updateDashboard();
  } catch (error) {
    console.error('Error refreshing dashboard data:', error);
  }
}

// Periodic updates
setInterval(refreshDashboardData, 10000); // Update every 10 seconds

// Start server
const PORT = process.env.DASHBOARD_PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Dashboard server running on http://localhost:${PORT}`);
  console.log(`📊 Real-time monitoring and manual trading available`);
});

export { dashboardData, updateDashboard };
