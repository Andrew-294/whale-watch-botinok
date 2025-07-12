require("dotenv").config();
const { ethers } = require("ethers");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const { BOT_TOKEN, CHAT_ID, WS_ETH, WS_ARB, WS_POLYGON, WS_BSC } = process.env;
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

const CHAINS = {
  eth: { name: "Ethereum", rpc: WS_ETH },
  arb: { name: "Arbitrum", rpc: WS_ARB },
  polygon: { name: "Polygon", rpc: WS_POLYGON },
  bsc: { name: "BSC", rpc: WS_BSC },
};

const DEX_ROUTER_ADDRESSES = new Set([
  "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f",
  "0xe592427a0aece92de3edee1f18e0157c05861564",
  "0x10ed43c718714eb63d5aa57b78b54704e256024e",
  "0xcde540d7eafe93ac5fe6233bee57e1270d3e330f",
]);

const BLACKLIST = new Set([
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831", // USDC.e
  "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", // USDT
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", // WETH Arbitrum
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH Mainnet
  "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", // WBTC
  "0xae7ab96520de3a18e5e111b5eaab095312d7fe84", // stETH
  "0x7f39c581f595b53c5cb5afef0c4b921e9d88207c", // wstETH
  "0xae78736cd615f374d3085123a210448e74fc6393", // rETH
  "0x853d955acef822db058eb8505911ed77f175b99e", // FRAX
  "0x5f98805a4e8be255a32880fdec7f6728c6568ba0", // LUSD
  "0x6982508145454ce325ddbe47a25d4ec3d2311933", // PEPE
  "0xc36442b4a4522e871399cd717abdd847ab11fe88", // SPX
]);

const COINGECKO_CHAIN_ID_MAP = {
  Ethereum: "ethereum",
  Arbitrum: "arbitrum-one",
  Polygon: "polygon-pos",
  BSC: "binance-smart-chain",
};

const tokenCache = new Map();
const short = (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

async function getTokenInfo(tokenAddress, chainName) {
  const now = Date.now();
  const cached = tokenCache.get(tokenAddress);
  if (cached && now - cached.timestamp < 5 * 60 * 1000) return cached;

  const platform = COINGECKO_CHAIN_ID_MAP[chainName] || "ethereum";
  const url = `https://api.coingecko.com/api/v3/coins/${platform}/contract/${tokenAddress}`;
  try {
    const { data } = await axios.get(url);
    const info = {
      symbol: data.symbol.toUpperCase(),
      decimals: data.detail_platforms?.[platform]?.decimal_place || 18,
      price: data.market_data?.current_price?.usd || 0,
      timestamp: now,
    };
    tokenCache.set(tokenAddress, info);
    return info;
  } catch {
    return { symbol: "UNKNOWN", decimals: 18, price: 0 };
  }
}

async function processChain(chainKey, { name, rpc }) {
  const provider = new ethers.WebSocketProvider(rpc);
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const latestBlock = await provider.getBlockNumber();
  const logs = await provider.getLogs({
    fromBlock: latestBlock - 5,
    toBlock: latestBlock,
    topics: [transferTopic],
  });

  for (const log of logs) {
    try {
      if (!log.data || log.data === "0x") continue;

      const iface = new ethers.Interface([
        "event Transfer(address indexed from, address indexed to, uint256 value)",
      ]);
      const parsed = iface.parseLog(log);

      const { from, to, value } = parsed.args;

      const tokenAddress = log.address.toLowerCase();
      const { symbol, decimals, price } = await getTokenInfo(
        tokenAddress,
        name,
      );
      if (!price || price === 0) continue;

      const amount = Number(ethers.formatUnits(value, decimals));
      const usdValue = amount * price;
      if (usdValue < 10_000) continue;

      // 🛑 Чёрный список
      if (BLACKLIST.has(tokenAddress)) {
        console.log(`⛔️ BLACKLIST: ${symbol} (${tokenAddress})`);
        continue;
      }

      const action = DEX_ROUTER_ADDRESSES.has(from.toLowerCase())
        ? "купил"
        : "получил";
      const buyLink = `https://app.uniswap.org/#/swap?outputCurrency=${tokenAddress}`;
      const msg =
        `🐋 *Whale Alert* (${name})\n` +
        `Кит ${action} *${amount.toFixed(2)} ${symbol}* (~$${usdValue.toLocaleString("en-US", { maximumFractionDigits: 0 })})`;

      await bot.sendMessage(CHAT_ID, msg, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: "🛒 Купить на Uniswap", url: buyLink }]],
        },
      });

      console.log(
        `✅ Отправлено: ${amount.toFixed(2)} ${symbol} ($${usdValue.toFixed(0)})`,
      );
      return true;
    } catch (e) {
      console.warn("⚠️ Ошибка в обработке:", e.message);
    }
  }

  return false;
}

async function loop() {
  console.log("⏳ Начинаем цикл проверки транзакций...");
  for (const [key, chain] of Object.entries(CHAINS)) {
    const sent = await processChain(key, chain);
    if (sent) break;
  }
  console.log("😴 Бот засыпает на 10 минут...");
  setTimeout(loop, 600_000);
}

console.log(
  "🐳 Бот запущен и работает в демо-режиме (1 сделка в 10 минут > $10,000)",
);
loop();
