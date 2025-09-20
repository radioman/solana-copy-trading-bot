import bs58 from "bs58";
import dotenv from "dotenv";
dotenv.config();
const DIRECT_ADDED_PUMPSWAP = process.env.DIRECT_ADDED_PUMPSWAP === "true";

export async function parseTransactionFromData(parsedTx) {
  if (!parsedTx) return null;

  const meta = parsedTx.meta;
  const innerInstructions = meta.innerInstructions;
  const flattenedInnerInstructions = (await innerInstructions?.flatMap((ix) => ix.instructions || [])) || [];
  const allInstructions = [...flattenedInnerInstructions];
  if (allInstructions.length === 0) return null;

  const validInstructions = allInstructions.filter((instruction) => instruction && instruction.data);

  if (validInstructions.length === 0) return null;

  const largestDataInstruction = await validInstructions.reduce((largest, current) => {
    if (!current || !current.data || !largest || !largest.data) {
      return largest || current;
    }
    return current.data.length > largest.data.length ? current : largest;
  });

  if (!largestDataInstruction || !largestDataInstruction.data) {
    return null;
  }
  const rawData = bs58.decode(largestDataInstruction.data);
  const buffer = Buffer.from(rawData);

  const parsedInstructionData = parseTransactionData(buffer);

  if (!parsedInstructionData) return null;

  return {
    solChanges: parseFloat(parsedInstructionData.solchange),
    tokenChanges: parseFloat(parsedInstructionData.tokenchange),
    isBuy: parsedInstructionData.isBuy,
    user: parsedInstructionData.user,
    mint: parsedInstructionData.mint,
    pool: parsedInstructionData.pool,
    liquidity: parsedInstructionData.liquidity,
    coinCreator: parsedInstructionData.coinCreator,
    context: parsedInstructionData.context,
  };
}

export async function tOutPut(data) {
  if (data && data.meta && data.transaction) {
    return await parseTransactionFromData(data);
  }

  const dataTx = data?.transaction?.transaction;
  if (!dataTx) return;
  const signature = bs58.encode(Buffer.from(dataTx?.transaction.signatures?.[0]));
  const meta = dataTx?.meta;
  const logs = meta?.logMessages;
  const logFilter = logs?.some((instruction) => instruction.match(instruction.match(/MintTo/i)));

  const innerInstructions = meta.innerInstructions;
  const flattenedInnerInstructions = (await innerInstructions?.flatMap((ix) => ix.instructions || [])) || [];
  const allInstructions = [...flattenedInnerInstructions];

  if (allInstructions.length === 0) return;

  const validInstructions = allInstructions.filter((instruction) => instruction && instruction.data);
  if (validInstructions.length === 0) return null;
  const largestDataInstruction = await validInstructions.reduce((largest, current) => {
    if (!current || !current.data || !largest || !largest.data) {
      return largest || current;
    }
    return current.data.length > largest.data.length ? current : largest;
  });

  if (!largestDataInstruction || !largestDataInstruction.data) {
    return null;
  }
  
  const parsedInstructionData = parseTransactionData(largestDataInstruction.data);

  if (!parsedInstructionData) return null;

  return {
    solChanges: parseFloat(parsedInstructionData.solchange),
    tokenChanges: parseFloat(parsedInstructionData.tokenchange),
    isBuy: parsedInstructionData.isBuy,
    user: parsedInstructionData.user,
    mint: parsedInstructionData.mint,
    pool: parsedInstructionData.pool,
    liquidity: parsedInstructionData.liquidity / 10 ** 9,
    coinCreator: parsedInstructionData.coinCreator,
    pool_status: parsedInstructionData.pool_status,
    signature: signature,
    context: parsedInstructionData.context,
  };
}

export function parseTransactionData(buffer) {
  try {
    function parsePublicKey(offset) {
      return bs58.encode(buffer.slice(offset, offset + 32)); // Convert 32 bytes to Base58
    }

    function parseBigInt(offset) {
      return buffer.readBigUInt64LE(offset).toString(); // Read 8 bytes as Little-Endian
    }
   

    if (buffer.length == 368) {
      const parsedData_PumpSwap = {
        mint: null,
        timestamp: parseBigInt(16), // 8 bytes (Timestamp)
        baseAmountIn: parseBigInt(24), // 8 bytes (Base amount in)
        minQuoteAmountOut: parseBigInt(32), // 8 bytes (Minimum quote amount out)
        userBaseTokenReserves: parseBigInt(40), // 8 bytes (User base token reserves)
        userQuoteTokenReserves: parseBigInt(48), // 8 bytes (User quote token reserves)
        poolBaseTokenReserves: parseBigInt(56), // 8 bytes (Pool base token reserves)
        poolQuoteTokenReserves: parseBigInt(64), // 8 bytes (Pool quote token reserves)
        quoteAmountOut: parseBigInt(72), // 8 bytes (Quote amount out)
        lpFeeBasisPoints: parseBigInt(80), // 8 bytes (LP fee basis points)
        lpFee: parseBigInt(88), // 8 bytes (LP fee)
        protocolFeeBasisPoints: parseBigInt(96), // 8 bytes (Protocol fee basis points)
        protocolFee: parseBigInt(104), // 8 bytes (Protocol fee)
        quoteAmountOutWithoutLpFee: parseBigInt(112), // 8 bytes (Quote amount out without LP fee)
        userQuoteAmountOut: parseBigInt(120), // 8 bytes (User quote amount out)
        pool: parsePublicKey(128), // 32 bytes (Pool address)
        user: parsePublicKey(160), // 32 bytes (User address)
        userBaseTokenAccount: parsePublicKey(192), // 32 bytes (User base token account)
        userQuoteTokenAccount: parsePublicKey(224), // 32 bytes (User quote token account)
        protocolFeeRecipient: parsePublicKey(256), // 32 bytes (Protocol fee recipient)
        protocolFeeRecipientTokenAccount: parsePublicKey(288), // 32 bytes (Protocol fee recipient token account)
        coinCreator: parsePublicKey(320), // 32 bytes (Coin creator address)
        coinCreatorFeeBasisPoints: parseBigInt(328), // 8 bytes (Coin creator fee basis points)
        coinCreatorFee: parseBigInt(336), // 8 bytes (Coin creator fee)
      };
      let isBuy = parsedData_PumpSwap.quoteAmountOutWithoutLpFee > parsedData_PumpSwap.quoteAmountOut;
      if (DIRECT_ADDED_PUMPSWAP) {
        const revertedContext = {
          ...parsedData_PumpSwap,
          userBaseTokenAccount: parsedData_PumpSwap.userQuoteTokenAccount,
          userQuoteTokenAccount: parsedData_PumpSwap.userBaseTokenAccount,
          baseAmountIn: parsedData_PumpSwap.quoteAmountOut,
          quoteAmountOut: parsedData_PumpSwap.baseAmountIn,
          poolBaseTokenReserves: parsedData_PumpSwap.poolQuoteTokenReserves,
          poolQuoteTokenReserves: parsedData_PumpSwap.poolBaseTokenReserves,
        };
        return {
          solchange: parsedData_PumpSwap.baseAmountIn, // swapped
          tokenchange: parsedData_PumpSwap.userQuoteAmountOut, // swapped
          isBuy: !isBuy, // also flip isBuy
          user: parsedData_PumpSwap.user,
          mint: parsedData_PumpSwap.mint,
          pool: parsedData_PumpSwap.pool,
          liquidity: parsedData_PumpSwap.poolBaseTokenReserves * 2, // swapped
          coinCreator: parsedData_PumpSwap.coinCreator,
          pool_status: "pumpswap",
          context: revertedContext,
        };
      }
      else
      return {
        solchange: parsedData_PumpSwap.userQuoteAmountOut,
        tokenchange: parsedData_PumpSwap.baseAmountIn,
        isBuy,
        user: parsedData_PumpSwap.user,
        mint: parsedData_PumpSwap.mint,
        pool: parsedData_PumpSwap.pool,
        liquidity: parsedData_PumpSwap.poolQuoteTokenReserves * 2,
        coinCreator: parsedData_PumpSwap.coinCreator,
        pool_status: "pumpswap",
        context: parsedData_PumpSwap,
      };
    } else if (buffer.length == 266) {
      const parsedData_PumpFun = {
        mint: parsePublicKey(16), // 32 bytes (Mint address)
        solAmount: parseBigInt(48), // 8 bytes (Amount in SOL)
        tokenAmount: parseBigInt(56), // 8 bytes (Token amount)
        isBuy: buffer[64] === 1, // 1 byte (Boolean: 0 = Sell, 1 = Buy)
        user: parsePublicKey(65), // 32 bytes (User address)
        timestamp: parseBigInt(97), // 8 bytes (Timestamp - Unix format)
        virtualSolReserves: parseBigInt(105), // 8 bytes (Virtual reserves)
        virtualTokenReserves: parseBigInt(113), // 8 bytes (Virtual token reserves)
        realSolReserves: parseBigInt(121), // 8 bytes (Real reserves)
        realTokenReserves: parseBigInt(129), // 8 bytes (Real token reserves)
        feeRecipient: parsePublicKey(137), // 32 bytes (Fee recipient address)
        feeBasisPoints: parseBigInt(169), // 8 bytes (Fee basis points)
        fee: parseBigInt(177), // 8 bytes (Fee amount)
        creator: parsePublicKey(185), // 32 bytes (Creator address)
        creatorFeeBasisPoints: parseBigInt(217), // 8 bytes (Creator fee basis points)
        creatorFee: parseBigInt(225), // 8 bytes (Creator fee amount)
        trackVolume: buffer[232] === 1,
        totalUnclaimedTokens: parseBigInt(233),
        totalClaimedTokens: parseBigInt(241),
        currentSolVolume: parseBigInt(249),
        lastUpdateTimestamp: parseBigInt(257),
      };

      let isBuy = parsedData_PumpFun.isBuy;

      return {
        solchange: parsedData_PumpFun.solAmount,
        tokenchange: parsedData_PumpFun.tokenAmount,
        isBuy,
        user: parsedData_PumpFun.user,
        mint: parsedData_PumpFun.mint,
        pool: null,
        liquidity: parsedData_PumpFun.virtualSolReserves,
        coinCreator: parsedData_PumpFun.creator,
        pool_status: "pumpfun",
        context: parsedData_PumpFun,
      };
    } else if (buffer.length == 146) {
      const parsedData_Raydium_LaunchLab = {
        poolState: parsePublicKey(16), // 32 bytes (Pool state address)
        totalBaseSell: parseBigInt(48), // 8 bytes (Total base sold)
        virtualBase: parseBigInt(56), // 8 bytes (Virtual base reserves)
        virtualQuote: parseBigInt(64), // 8 bytes (Virtual quote reserves)
        realBaseBefore: parseBigInt(72), // 8 bytes (Real base before)
        realQuoteBefore: parseBigInt(80), // 8 bytes (Real quote before)
        realBaseAfter: parseBigInt(88), // 8 bytes (Real base after)
        realQuoteAfter: parseBigInt(96), // 8 bytes (Real quote after)
        amountIn: parseBigInt(104), // 8 bytes (Amount in)
        amountOut: parseBigInt(112), // 8 bytes (Amount out)
        protocolFee: parseBigInt(120), // 8 bytes (Protocol fee)
        platformFee: parseBigInt(128), // 8 bytes (Platform fee)
        shareFee: parseBigInt(136), // 8 bytes (Share fee)
        tradeDirection: buffer[144] , // 1 byte (1 = sell, 0 = buy)
        poolStatus: buffer[145] === 0 ? { normal: {} } : { fund: {} }, // 1 byte (0 = normal, 1 = fund)
      };
      const isBuy = !parsedData_Raydium_LaunchLab.tradeDirection;
      let solAmount = 0;
      let tokenAmount = 0;
      if (isBuy){
        solAmount = parsedData_Raydium_LaunchLab.amountIn;
        tokenAmount = parsedData_Raydium_LaunchLab.amountOut;
      }else{
        solAmount = parsedData_Raydium_LaunchLab.amountOut;
        tokenAmount = parsedData_Raydium_LaunchLab.amountIn;
      }

      return {
        solchange: solAmount,
        tokenchange: tokenAmount,
        isBuy,
        user: null,
        mint: null,
        pool: parsedData_Raydium_LaunchLab.poolState,
        liquidity: 2*parsedData_Raydium_LaunchLab.realQuoteAfter,
        coinCreator: parsedData_Raydium_LaunchLab.poolState,
        pool_status: "raydium_launchlab",
        context: parsedData_Raydium_LaunchLab,
      };
    } else  {
      return {
      solchange: 0,
      tokenchange: 0,
      isBuy: false,
      user: null,
      mint: null,
      pool: null,
      liquidity: 0,
      coinCreator: null,
      pool_status: "raydium",
      context: null,
    };
  } }catch (error) {
    console.error("Error parsing transaction data:", error);
  }
}
