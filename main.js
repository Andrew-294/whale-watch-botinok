require("dotenv").config();
const { ethers } = require("ethers");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

const { BOT_TOKEN, WS_ETH, WS_ARB, WS_POLYGON, WS_BSC } = process.env;
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const SUBSCRIBERS_FILE = "subscribers.json";
let subscribers = {};

try {
  subscribers = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, "utf-8"));
  console.log("✅ Подписчики загружены:", subscribers);
} catch {
  console.log("ℹ️ Нет сохранённых подписчиков, начинаем с нуля.");
}

function saveSubscribers() {
  fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(subscribers, null, 2));
}

bot.onText(/\/start/, (msg) => {
  const id = msg.chat.id;
  if (!subscribers[id]) {
    subscribers[id] = { threshold: 10000, customBlacklist: [] };
    saveSubscribers();
    console.log(`➕ Новый подписчик: ${id}`);
  }
  bot.sendMessage(
    id,
    `👋 Привет! Ты подписан на Whale Watch!\nБуду присылать тебе сделки китов.\n\n📌 Команды:\n/threshold 1000 — изменить минимальную сумму\n/block 0x... — добавить токен в блок-лист\n/unblock 0x... — удалить токен из блок-листа\n/status — показать текущие фильтры\n\nПо умолчанию — сделки от $10,000 и выше.`,
    { parse_mode: "Markdown" },
  );
});

bot.onText(/\/threshold (\d+)/, (msg, match) => {
  const id = msg.chat.id;
  const value = parseInt(match[1]);
  if (isNaN(value) || value < 100)
    return bot.sendMessage(id, "❌ Минимальный порог — $100.");
  if (!subscribers[id])
    subscribers[id] = { threshold: value, customBlacklist: [] };
  else subscribers[id].threshold = value;
  saveSubscribers();
  bot.sendMessage(
    id,
    `🔔 Новый порог установлен: *$${value.toLocaleString()}*`,
    { parse_mode: "Markdown" },
  );
});

bot.onText(/\/block (0x[a-fA-F0-9]{40})/, (msg, match) => {
  const id = msg.chat.id;
  const address = match[1].toLowerCase();
  if (!subscribers[id])
    subscribers[id] = { threshold: 10000, customBlacklist: [] };
  if (!subscribers[id].customBlacklist.includes(address)) {
    subscribers[id].customBlacklist.push(address);
    saveSubscribers();
  }
  bot.sendMessage(id, `🚫 Токен *${address}* добавлен в твой блок-лист.`, {
    parse_mode: "Markdown",
  });
});

bot.onText(/\/unblock (0x[a-fA-F0-9]{40})/, (msg, match) => {
  const id = msg.chat.id;
  const address = match[1].toLowerCase();
  const list = subscribers[id]?.customBlacklist;
  if (!list || !list.includes(address))
    return bot.sendMessage(
      id,
      `❌ Токен *${address}* не найден в блок-листе.`,
      { parse_mode: "Markdown" },
    );
  subscribers[id].customBlacklist = list.filter((a) => a !== address);
  saveSubscribers();
  bot.sendMessage(id, `✅ Токен *${address}* удалён из блок-листа.`, {
    parse_mode: "Markdown",
  });
});

bot.onText(/\/status/, (msg) => {
  const id = msg.chat.id;
  const threshold = subscribers[id]?.threshold || 10000;
  const enabledChains = Object.values(CHAINS)
    .map((c) => c.name)
    .join(", ");
  const bl = subscribers[id]?.customBlacklist || [];
  const short = (addr) => addr.slice(0, 6) + "..." + addr.slice(-4);
  const blMsg = bl.length > 0 ? bl.map(short).join(", ") : "–";
  const statusMsg =
    `🔧 *Текущие фильтры:*\n` +
    `Минимальная сумма: *$${threshold.toLocaleString()}*\n` +
    `Сети: ${enabledChains}\n` +
    `Блок-лист: ${blMsg}`;
  bot.sendMessage(id, statusMsg, { parse_mode: "Markdown" });
});

const CHAINS = {
  eth: { name: "Ethereum", rpc: WS_ETH },
  arb: { name: "Arbitrum", rpc: WS_ARB },
  polygon: { name: "Polygon", rpc: WS_POLYGON },
  bsc: { name: "BSC", rpc: WS_BSC },
};

const DEX_ROUTER_ADDRESSES = new Set([
  "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d",
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
  "0x514910771af9ca656af840dff83e8264ecf986ca",
  "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f",
  "0xe592427a0aece92de3edee1f18e0157c05861564",
  "0x10ed43c718714eb63d5aa57b78b54704e256024e",
  "0xcde540d7eafe93ac5fe6233bee57e1270d3e330f",
]);

const BLACKLIST = new Set([
  "0xeb51d9a39ad5eef215dc0bf39a8821ff804a0f01",
  "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
  "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
  "0xb035723d62e0e2ea7499d76355c9d560f13ba404",
  "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8",
  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
  "0xdac17f958d2ee523a2206206994597c13d831ec7",
  "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
  "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
  "0x55d398326f99059ff775485246999027b3197955",
  "0x6b175474e89094c44da98b954eedeac495271d0f",
  "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
  "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063",
  "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3",
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
  "0x6982508145454ce325ddbe47a25d4ec3d2311933",
  "0xc36442b4a4522e871399cd717abdd847ab11fe88",
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
      const { from, value } = parsed.args;
      const tokenAddress = log.address.toLowerCase();

      const { symbol, decimals, price } = await getTokenInfo(
        tokenAddress,
        name,
      );
      if (!price || price === 0) continue;

      const amount = Number(ethers.formatUnits(value, decimals));
      const usdValue = amount * price;
      if (usdValue < 100) continue;

      for (const [chatId, settings] of Object.entries(subscribers)) {
        const threshold = settings.threshold || 10000;
        const userBlacklist = settings.customBlacklist || [];

        const isBlacklisted =
          BLACKLIST.has(tokenAddress) || userBlacklist.includes(tokenAddress);

        const isFromDex = DEX_ROUTER_ADDRESSES.has(from.toLowerCase());
        if (isBlacklisted && !isFromDex) {
          console.log(
            `⛔️ BLACKLIST (глоб/польз.): ${symbol} (${tokenAddress})`,
          );
          continue;
        }

        if (usdValue < threshold) continue;

        const action = isFromDex ? "купил" : "получил";
        const buyLink = `https://app.uniswap.org/#/swap?outputCurrency=${tokenAddress}`;

        const explorer = EXPLORER_URLS[name] || "https://etherscan.io/token/";
        const msg =
          `🐋 *Whale Alert* (${name})\n` +
          `Кит ${action} *${amount.toFixed(2)} ${symbol}* (~$${usdValue.toLocaleString("en-US", { maximumFractionDigits: 0 })})\n` +
          `Адрес: [${tokenAddress}](${explorer}${tokenAddress})`;

        await bot.sendMessage(chatId, msg, {
          parse_mode: "Markdown",
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [[{ text: "🛒 Купить на Uniswap", url: buyLink }]],
          },
        });

        console.log(`✅ Отправлено: ${symbol} ($${usdValue.toFixed(0)})`);
      }
    } catch (e) {
      console.warn("⚠️ Ошибка в обработке:", e.message);
    }
  }
}

async function loop() {
  console.log("⏳ Начинаем цикл проверки транзакций...");
  for (const [key, chain] of Object.entries(CHAINS)) {
    const sent = await processChain(key, chain);
    if (sent) break;
  }
  console.log("😴 Бот засыпает");
  setTimeout(loop, 1_000);
}

console.log("🐳 Бот запущен и работает");
loop();
