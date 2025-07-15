require("dotenv").config();
const { ethers } = require("ethers");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

const { BOT_TOKEN, WS_ETH, WS_ARB, WS_POLYGON, WS_BSC } = process.env;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const SUBSCRIBERS_FILE = "subscribers.json";
let subscribers = new Set();

// Загружаем подписчиков из файла
try {
  const raw = fs.readFileSync(SUBSCRIBERS_FILE, "utf-8");
  subscribers = new Set(JSON.parse(raw));
  console.log("✅ Подписчики загружены:", [...subscribers]);
} catch {
  console.log("ℹ️ Нет сохранённых подписчиков, начинаем с нуля.");
}

// Команда /start
bot.onText(/\/start/, (msg) => {
  const id = msg.chat.id;
  if (!subscribers.has(id)) {
    subscribers.add(id);
    fs.writeFileSync(
      SUBSCRIBERS_FILE,
      JSON.stringify([...subscribers], null, 2),
    );
    console.log(`➕ Новый подписчик: ${id}`);
  }
  bot.sendMessage(
    id,
    "👋 Привет! Я бот Whale Watch. Теперь ты будешь получать крупные сделки китов.",
  );
});

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
  // USDC
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC Mainnet
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831", // USDC.e Arbitrum
  "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", // USDC Polygon
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC BSC

  // USDT
  "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT Mainnet
  "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", // USDT Arbitrum
  "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", // USDT Polygon
  "0x55d398326f99059ff775485246999027b3197955", // USDT BSC

  // DAI
  "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI Mainnet
  "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", // DAI Arbitrum
  "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063", // DAI Polygon
  "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3", // DAI BSC

  // WETH / Wrapped ETH
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH Mainnet
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", // WETH Arbitrum
  "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", // WETH Polygon

  // WBTC
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", // WBTC Mainnet
  "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6", // WBTC Polygon
  "0x408d4c2f93282bcdf4f5b348b8251f894d0caacb", // WBTC Arbitrum

  // Стейкинг токены
  "0xae7ab96520de3a18e5e111b5eaab095312d7fe84", // stETH
  "0x7f39c581f595b53c5cb5afef0c4b921e9d88207c", // wstETH
  "0xae78736cd615f374d3085123a210448e74fc6393", // rETH

  // Стейблкоины
  "0x853d955acef822db058eb8505911ed77f175b99e", // FRAX
  "0x5f98805a4e8be255a32880fdec7f6728c6568ba0", // LUSD
  "0x0000000000085d4780b73119b644ae5ecd22b376", // TUSD
  "0x8f8526dbfd6e38e3d8307702cA8469Bb42C6D94e", // USDP
  "0x056fd409e1d7a124bd7017459dfea2f387b6d5cd", // GUSD
  "0xe9e7cea3dedca5984780bafc599bd69add087d56", // BUSD

  // Мемы / бесполезные токены
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

      if (
        BLACKLIST.has(tokenAddress) &&
        !DEX_ROUTER_ADDRESSES.has(from.toLowerCase())
      ) {
        console.log(`⛔️ BLACKLIST (получен): ${symbol} (${tokenAddress})`);
        continue;
      }

      const action = DEX_ROUTER_ADDRESSES.has(from.toLowerCase())
        ? "купил"
        : "получил";
      const buyLink = `https://app.uniswap.org/#/swap?outputCurrency=${tokenAddress}`;
      const msg =
        `🐋 *Whale Alert* (${name})\n` +
        `Кит ${action} *${amount.toFixed(2)} ${symbol}* (~$${usdValue.toLocaleString("en-US", { maximumFractionDigits: 0 })})`;

      for (const chatId of subscribers) {
        await bot.sendMessage(chatId, msg, {
          parse_mode: "Markdown",
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [[{ text: "🛒 Купить на Uniswap", url: buyLink }]],
          },
        });
      }

      console.log(
        `✅ Отправлено ${subscribers.size} подписчикам: ${amount.toFixed(2)} ${symbol} ($${usdValue.toFixed(0)})`,
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
