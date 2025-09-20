# Percentage-Based Buy Amount Feature

## Overview

The Percentage-Based Buy Amount feature allows your trading bot to automatically adjust its buy amounts based on the SOL changes of target wallets, rather than using a fixed buy amount. This enables dynamic position sizing that scales with market activity.

## How It Works

Instead of making additional RPC calls to check wallet balances, the bot uses the `solChanges` data already parsed from gRPC transaction streams. When a target wallet makes a transaction, the bot calculates your buy amount as a percentage of their SOL change.

### Key Benefits

1. **No Additional RPC Calls**: Uses existing gRPC parsed data (`solChanges`)
2. **Dynamic Position Sizing**: Automatically scales with target wallet activity
3. **Risk Management**: Built-in minimum and maximum bounds for safety
4. **Backward Compatibility**: Falls back to fixed amount if percentage is not set
5. **Real-time Adaptation**: Responds immediately to market conditions

## Configuration

### Environment Variables

Add this to your `.env` file:

```bash
# Buy amount configuration
# Set buy amount as a percentage of target wallet's SOL change (0.1 = 10%, 1.0 = 100%, 2.0 = 200%)
# If not set, will use the fixed BUY_AMOUNT value
BUY_AMOUNT_PERCENTAGE=1.0
```

### Percentage Examples

| BUY_AMOUNT_PERCENTAGE | Behavior |
|----------------------|----------|
| `0.1` | Buy 10% of target wallet's SOL change |
| `0.5` | Buy 50% of target wallet's SOL change |
| `1.0` | Buy 100% of target wallet's SOL change (same amount) |
| `1.5` | Buy 150% of target wallet's SOL change (1.5x their amount) |
| `2.0` | Buy 200% of target wallet's SOL change (2x their amount) |

## Implementation Details

### Safety Bounds

The feature includes built-in safety bounds to prevent extreme buy amounts:

- **Minimum**: 0.01 SOL (prevents dust transactions)
- **Maximum**: 10.0 SOL (prevents excessive risk)

### Calculation Logic

```javascript
// Convert solChanges from lamports to SOL
const solChangesInSol = Math.abs(solChanges) / LAMPORTS_PER_SOL;

// Calculate percentage-based amount
const dynamicAmount = solChangesInSol * BUY_AMOUNT_PERCENTAGE;

// Apply safety bounds
const clampedAmount = Math.max(0.01, Math.min(10.0, dynamicAmount));
```

### Fallback Behavior

If `BUY_AMOUNT_PERCENTAGE` is not set or calculation fails:
- Bot uses the fixed `BUY_AMOUNT` value
- No changes to existing behavior
- Full backward compatibility maintained

## Usage Examples

### Example 1: Conservative Copy Trading (10%)
```bash
BUY_AMOUNT_PERCENTAGE=0.1
```

- Target wallet spends 1.0 SOL → Bot buys 0.1 SOL
- Target wallet spends 5.0 SOL → Bot buys 0.5 SOL
- Target wallet spends 0.05 SOL → Bot buys 0.01 SOL (clamped to minimum)

### Example 2: Matching Target Wallets (100%)
```bash
BUY_AMOUNT_PERCENTAGE=1.0
```

- Target wallet spends 0.5 SOL → Bot buys 0.5 SOL
- Target wallet spends 2.0 SOL → Bot buys 2.0 SOL
- Target wallet spends 15.0 SOL → Bot buys 10.0 SOL (clamped to maximum)

### Example 3: Aggressive Scaling (200%)
```bash
BUY_AMOUNT_PERCENTAGE=2.0
```

- Target wallet spends 0.5 SOL → Bot buys 1.0 SOL
- Target wallet spends 3.0 SOL → Bot buys 6.0 SOL
- Target wallet spends 8.0 SOL → Bot buys 10.0 SOL (clamped to maximum)

## Testing

Use the provided test script to verify your configuration:

```bash
node test_percentage_buy.js
```

This will show you how different target wallet SOL changes translate to your buy amounts.

## Monitoring and Logs

When the feature is active, you'll see detailed logs like:

```
[2024-01-15T10:30:45.124Z] 💰 Dynamic Buy Amount Calculation:
   • Target SOL Change: 2.5000 SOL
   • Percentage: 150.0%
   • Calculated Amount: 3.7500 SOL
   • Final Amount (clamped): 3.7500 SOL

[2024-01-15T10:30:45.125Z] 🎯 Using buy amount: 3.75 SOL (dynamic)
```

## Balance Requirements

When using percentage-based buying, ensure your wallet has sufficient balance:

- **Fixed Amount**: `BUY_AMOUNT + 0.1 SOL` (for fees)
- **Dynamic Amount**: `(Max Target Amount × BUY_AMOUNT_PERCENTAGE) + 0.1 SOL` (for fees)

### Recommended Minimum Balance

```javascript
// Estimate max target wallet transaction (conservative: 5 SOL)
const estimatedMaxTargetAmount = 5.0;
const maxDynamicAmount = estimatedMaxTargetAmount * BUY_AMOUNT_PERCENTAGE;
const recommendedMinBalance = Math.max(buyAmount, maxDynamicAmount) + 0.1;
```

## Best Practices

### 1. Start Conservative
- Begin with `BUY_AMOUNT_PERCENTAGE=0.5` or lower
- Monitor performance and adjust gradually

### 2. Monitor Balance
- Ensure sufficient SOL for maximum possible buy amounts
- Consider the upper bound (10 SOL) when setting percentages

### 3. Risk Management
- Higher percentages mean larger position sizes
- Balance between following targets and managing risk

### 4. Market Conditions
- Adjust percentage based on market volatility
- Lower percentages in uncertain markets

## Troubleshooting

### Common Issues

1. **Buy amounts too small**
   - Check if `BUY_AMOUNT_PERCENTAGE` is set correctly
   - Verify target wallets are making transactions

2. **Buy amounts too large**
   - Reduce `BUY_AMOUNT_PERCENTAGE`
   - Check wallet balance for sufficient funds

3. **Feature not working**
   - Verify `BUY_AMOUNT_PERCENTAGE` is in `.env` file
   - Check logs for calculation errors
   - Ensure fallback to fixed amount is working

### Debug Commands

Use the built-in status commands to monitor the feature:

```bash
# Manual status check
kill -SIGUSR1 <process_id>

# Manual balance check
kill -SIGUSR2 <process_id>
```

## Migration from Fixed Amount

### Step 1: Backup Current Settings
```bash
# Save current BUY_AMOUNT
echo "Current BUY_AMOUNT: $BUY_AMOUNT"
```

### Step 2: Add Percentage Configuration
```bash
# Add to .env file
echo "BUY_AMOUNT_PERCENTAGE=0.5" >> .env
```

### Step 3: Test with Small Percentage
```bash
# Start with 50% to test
BUY_AMOUNT_PERCENTAGE=0.5
```

### Step 4: Monitor and Adjust
- Watch logs for dynamic amount calculations
- Adjust percentage based on performance
- Ensure wallet balance is sufficient

## Performance Impact

- **No additional RPC calls**: Uses existing gRPC data
- **Minimal CPU overhead**: Simple percentage calculation
- **Real-time response**: Immediate adaptation to market changes
- **Memory efficient**: No additional data storage required

## Security Considerations

- **Input validation**: All percentages are validated and clamped
- **Bounds checking**: Minimum and maximum limits prevent extreme values
- **Error handling**: Graceful fallback to fixed amounts on errors
- **No external dependencies**: Uses only existing transaction data

## Future Enhancements

Potential improvements for future versions:

1. **Dynamic percentage adjustment** based on market conditions
2. **Multiple percentage tiers** for different target wallet sizes
3. **Historical analysis** to optimize percentage settings
4. **Risk-adjusted percentages** based on volatility metrics

## Support

For issues or questions about this feature:

1. Check the logs for error messages
2. Verify environment variable configuration
3. Test with the provided test script
4. Review this documentation for best practices

---

**Note**: This feature maintains full backward compatibility. If you don't set `BUY_AMOUNT_PERCENTAGE`, your bot will continue using the fixed `BUY_AMOUNT` as before.
