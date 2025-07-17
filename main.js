require("dotenv").config();
const { ethers } = require("ethers");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

const { BOT_TOKEN, CHANNEL_ID, OWNER_ID } = process.env;
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const SUBSCRIBERS_FILE = "subscribers.json";
let subscribers = {};

// 1) Загрузка подписчиков
try {
  const raw = fs.readFileSync(SUBSCRIBERS_FILE, "utf-8");
  subscribers = JSON.parse(raw);
  console.log("✅ Подписчики загружены");
} catch {
  console.log("ℹ️ Нет сохранённых подписчиков, начинаем с нуля.");
}

function saveSubscribers() {
  fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(subscribers, null, 2));
}

// 2) /start — регистрация, инициализируем rpcKeys, customBlacklist и порог
bot.onText(/\/start/, (msg) => {
  const id = msg.chat.id;
  if (!subscribers[id]) {
    subscribers[id] = {
      threshold: 10000,
      rpcKeys: {},
      customBlacklist: [],
    };
    saveSubscribers();
    console.log(`➕ Новый подписчик: ${id}`);
  }
  bot.sendMessage(
    id,
    "👋 Привет! Ты подписан на Whale Watch!\n" +
      "Буду присылать тебе сделки китов.\n\n" +
      "📌 Команды:\n" +
      "/threshold 1000 — изменить минимальную сумму\n" +
      "/setkey <chain> <wss-url> — задать свой RPC (eth|arb|polygon|bsc)\n" +
      "/block 0x... — добавить токен в личный блок-лист\n" +
      "/unblock 0x... — удалить токен из личного блок-листа\n" +
      "/status — показать текущие настройки\n\n" +
      "⏳ До задания ключей уведомлений не будет.",
    { parse_mode: "Markdown" },
  );
});

// 3) /threshold — настройка порога
bot.onText(/\/threshold (\d+)/, (msg, match) => {
  const id = msg.chat.id;
  const value = parseInt(match[1], 10);
  if (isNaN(value) || value < 100) {
    return bot.sendMessage(id, "❌ Минимальный порог — $100.");
  }
  if (!subscribers[id]) {
    subscribers[id] = { threshold: value, rpcKeys: {}, customBlacklist: [] };
  } else {
    subscribers[id].threshold = value;
  }
  saveSubscribers();
  bot.sendMessage(
    id,
    `🔔 Новый порог установлен: *$${value.toLocaleString()}*`,
    { parse_mode: "Markdown" },
  );
});

// 4) /setkey — пользователь задаёт wss-URL для сети
bot.onText(/\/setkey (eth|arb|polygon|bsc) (.+)/, (msg, match) => {
  const id = msg.chat.id;
  const chain = match[1];
  const rpcUrl = match[2].trim();
  if (!subscribers[id]) {
    subscribers[id] = { threshold: 10000, rpcKeys: {}, customBlacklist: [] };
  }
  subscribers[id].rpcKeys[chain] = rpcUrl;
  saveSubscribers();
  bot.sendMessage(id, `✅ RPC для *${chain}* сохранён:\n\`${rpcUrl}\``, {
    parse_mode: "Markdown",
  });
});

// 5) /block — добавить токен в личный блок-лист
bot.onText(/\/block (0x[a-fA-F0-9]{40})/, (msg, match) => {
  const id = msg.chat.id;
  const address = match[1].toLowerCase();
  if (!subscribers[id]) {
    subscribers[id] = { threshold: 10000, rpcKeys: {}, customBlacklist: [] };
  }
  const list = subscribers[id].customBlacklist;
  if (!list.includes(address)) {
    list.push(address);
    saveSubscribers();
  }
  bot.sendMessage(id, `🚫 Токен *${address}* добавлен в личный блок-лист.`, {
    parse_mode: "Markdown",
  });
});

// 6) /unblock — удалить токен из личного блок-листа
bot.onText(/\/unblock (0x[a-fA-F0-9]{40})/, (msg, match) => {
  const id = msg.chat.id;
  const address = match[1].toLowerCase();
  const list = subscribers[id]?.customBlacklist || [];
  if (!list.includes(address)) {
    return bot.sendMessage(
      id,
      `❌ Токен *${address}* не найден в блок-листе.`,
      { parse_mode: "Markdown" },
    );
  }
  subscribers[id].customBlacklist = list.filter((a) => a !== address);
  saveSubscribers();
  bot.sendMessage(id, `✅ Токен *${address}* удалён из блок-листа.`, {
    parse_mode: "Markdown",
  });
});

// 7) /status — показывает порог, ключи и личный блок-лист
bot.onText(/\/status/, (msg) => {
  const id = msg.chat.id;
  const th = subscribers[id]?.threshold || 10000;
  const keys = subscribers[id]?.rpcKeys || {};
  const bl = subscribers[id]?.customBlacklist || [];
  const chains = Object.keys(keys).length
    ? Object.entries(keys)
        .map(([c, u]) => `• ${c}: \`${u}\``)
        .join("\n")
    : "— нет ни одной сети";
  const short = (addr) => addr.slice(0, 6) + "..." + addr.slice(-4);
  const blMsg = bl.length ? bl.map(short).join(", ") : "— нет токенов";
  const text =
    `🔧 *Текущие настройки:*\n` +
    `Минимальный порог: *$${th.toLocaleString()}*\n` +
    `RPC-ключи:\n${chains}\n` +
    `Личный блок-лист:\n${blMsg}`;
  bot.sendMessage(id, text, { parse_mode: "Markdown" });
});

// ——————————————————————————————————
// 8) Новый per-user цикл опроса
// ——————————————————————————————————

const CHAINS = {
  eth: { name: "Ethereum" },
  arb: { name: "Arbitrum" },
  polygon: { name: "Polygon" },
  bsc: { name: "BSC" },
};

const DEX_ROUTER_ADDRESSES = new Set([
  "0x5c69bee7…",
  "0xe592427a…",
  "0x10ed43c7…",
  "0xcde540d7…",
]);

const BLACKLIST = new Set([
  "0xdefa4e8a7bcba345f687a2f1456f5edd9ce97202",
  "0x085780639cc2cacd35e474e71f4d000e2405d8f6",
  "0x514910771af9ca656af840dff83e8264ecf986ca",
  "0x9813037ee2218799597d83d4a5b6f3b6778218d9",
  "0xd533a949740bb3306d119cc777fa900ba034cd52",
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
  // USDT
  "0xdac17f958d2ee523a2206206994597c13d831ec7",
  "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
  "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
  "0x55d398326f99059ff775485246999027b3197955",
  // DAI
  "0x6b175474e89094c44da98b954eedeac495271d0f",
  "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
  "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063",
  "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3",
  // WETH / WBTC / Lido / Stablecoins
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
  "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
  "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6",
  "0x408d4c2f93282bcdf4f5b348b8251f894d0caacb",
  "0xae7ab96520de3a18e5e111b5eaab095312d7fe84",
  "0x7f39c581f595b53c5cb5afef0c4b921e9d88207c",
  "0xae78736cd615f374d3085123a210448e74fc6393",
  "0x853d955acef822db058eb8505911ed77f175b99e",
  "0x5f98805a4e8be255a32880fdec7f6728c6568ba0",
  "0x0000000000085d4780b73119b644ae5ecd22b376",
  "0x8f8526dbfd6e38e3d8307702cA8469Bb42C6D94e",
  "0x056fd409e1d7a124bd7017459dfea2f387b6d5cd",
  "0xe9e7cea3dedca5984780bafc599bd69add087d56",
  // MEME токены
  "0x6982508145454ce325ddbe47a25d4ec3d2311933", // PEPE
  "0xc36442b4a4522e871399cd717abdd847ab11fe88", // SPX
]);

const COINGECKO_CHAIN_ID_MAP = {
  Ethereum: "ethereum",
  Arbitrum: "arbitrum-one",
  Polygon: "polygon-pos",
  BSC: "binance-smart-chain",
};

const EXPLORER_URLS = {
  Ethereum: "https://etherscan.io/token/",
  Arbitrum: "https://arbiscan.io/token/",
  Polygon: "https://polygonscan.com/token/",
  BSC: "https://bscscan.com/token/",
};

const tokenCache = new Map();
async function getTokenInfo(tokenAddress, chainName) {
  const now = Date.now();
  const cached = tokenCache.get(tokenAddress);
  if (cached && now - cached.timestamp < 5 * 60 * 1000) return cached;
  const platform = COINGECKO_CHAIN_ID_MAP[chainName] || "ethereum";
  try {
    const { data } = await axios.get(
      `https://api.coingecko.com/api/v3/coins/${platform}/contract/${tokenAddress}`,
    );
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

async function processChainForUser(chatId, chainKey, rpcUrl) {
  const { name } = CHAINS[chainKey];
  const provider = new ethers.WebSocketProvider(rpcUrl);
  const topic = ethers.id("Transfer(address,address,uint256)");
  const latest = await provider.getBlockNumber();
  const logs = await provider.getLogs({
    fromBlock: latest - 5,
    toBlock: latest,
    topics: [topic],
  });

  for (const log of logs) {
    try {
      if (!log.data || log.data === "0x") continue;
      const iface = new ethers.Interface([
        "event Transfer(address indexed from,address indexed to,uint256 value)",
      ]);
      const {
        args: { from, value },
      } = iface.parseLog(log);
      const tokenAddress = log.address.toLowerCase();

      const { symbol, decimals, price } = await getTokenInfo(
        tokenAddress,
        name,
      );
      if (!price) continue;

      const amount = Number(ethers.formatUnits(value, decimals));
      const usdValue = amount * price;
      const threshold = subscribers[chatId].threshold || 10000;
      if (usdValue < threshold) continue;

      const isDex = DEX_ROUTER_ADDRESSES.has(from.toLowerCase());
      if (BLACKLIST.has(tokenAddress) && !isDex) continue;

      // Личный блок-лист
      if ((subscribers[chatId].customBlacklist || []).includes(tokenAddress)) {
        continue;
      }

      const action = isDex ? "купил" : "получил";
      const buyLink = `https://app.uniswap.org/#/swap?outputCurrency=${tokenAddress}`;
      const explorer = EXPLORER_URLS[name] || EXPLORER_URLS.Ethereum;
      const msg =
        `🐋 *Whale Alert* (${name})\n` +
        `Кит ${action} *${amount.toFixed(2)} ${symbol}* (~$${usdValue.toLocaleString()})\n` +
        `Адрес: [${tokenAddress}](${explorer}${tokenAddress})`;

      await bot.sendMessage(chatId, msg, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: "🛒 Купить", url: buyLink }]],
        },
      });

      if (String(chatId) === OWNER_ID) {
        await bot.sendMessage(CHANNEL_ID, msg, {
          parse_mode: "Markdown",
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [[{ text: "🛒 Купить", url: buyLink }]],
          },
        });
      }
    } catch (e) {
      console.warn(`⚠️ processChainForUser error: ${e.message}`);
    }
  }
}

async function loop() {
  console.log("⏳ Начинаем цикл для каждого пользователя…");
  for (const [chatId, settings] of Object.entries(subscribers)) {
    const keys = settings.rpcKeys || {};
    if (!Object.keys(keys).length) continue;
    for (const [chainKey, rpcUrl] of Object.entries(keys)) {
      await processChainForUser(chatId, chainKey, rpcUrl);
    }
  }
  console.log("😴 Засыпаю на 10 секунд…");
  setTimeout(loop, 10_000);
}

console.log("🐳 Бот запущен");
loop();
