import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const cache = new Map();
const cacheMs = 60 * 1000;

const allowedRanges = new Set(["5d", "1mo", "6mo", "ytd", "1y", "5y"]);
const allowedIntervals = new Set(["15m", "1d", "1wk"]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function json(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseSymbols(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index)
    .slice(0, 8);
}

function cacheKey(symbol, range, interval) {
  return `${symbol}|${range}|${interval}`;
}

function getCached(key, maxAgeMs) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < maxAgeMs) return cached.data;
  return null;
}

function setCached(key, data) {
  cache.set(key, { time: Date.now(), data });
  return data;
}

async function fetchSymbol(symbol, range, interval) {
  const key = cacheKey(symbol, range, interval);
  const cached = getCached(key, cacheMs);
  if (cached) return cached;

  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", range);
  url.searchParams.set("interval", interval);
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "history");

  const upstream = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0 stock-sync-local-app",
    },
  });

  if (!upstream.ok) {
    throw new Error(`Yahoo Finance 返回 HTTP ${upstream.status}`);
  }

  const body = await upstream.json();
  const result = body?.chart?.result?.[0];
  const upstreamError = body?.chart?.error;
  if (upstreamError) {
    throw new Error(upstreamError.description || upstreamError.code || "Yahoo Finance 返回错误");
  }
  if (!result?.timestamp?.length) {
    throw new Error("没有返回时间序列");
  }

  const closes = result.indicators?.quote?.[0]?.close || [];
  const points = result.timestamp
    .map((time, index) => ({ time, close: closes[index] }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.close));

  if (!points.length) {
    throw new Error("没有可用收盘价");
  }

  const data = {
    symbol,
    currency: result.meta?.currency || "",
    exchange: result.meta?.exchangeName || "",
    currentPrice: Number.isFinite(result.meta?.regularMarketPrice) ? result.meta.regularMarketPrice : points.at(-1)?.close,
    currentTime: Number.isFinite(result.meta?.regularMarketTime) ? result.meta.regularMarketTime : points.at(-1)?.time,
    source: "Yahoo Finance chart API",
    points,
  };
  return setCached(key, data);
}

async function fetchQuote(symbols) {
  const key = `quote|${symbols.join(",")}`;
  const cached = getCached(key, cacheMs);
  if (cached) return cached;

  const errors = [];
  const yahoo = await fetchYahooQuote(symbols).catch((error) => {
    errors.push(error.message);
    return [];
  });
  const missing = symbols.filter((symbol) => !yahoo.some((quote) => quote.symbol === symbol && (Number.isFinite(quote.trailingPE) || Number.isFinite(quote.forwardPE))));
  const fallbacks = missing.length ? await fetchFundamentalFallbacks(missing, errors) : [];
  const data = [...yahoo, ...fallbacks.filter((quote) => !yahoo.some((item) => item.symbol === quote.symbol))];
  if (!data.length && errors.length) throw new Error(errors.join("; "));
  return setCached(key, data);
}

async function fetchYahooQuote(symbols) {
  const url = new URL("https://query1.finance.yahoo.com/v7/finance/quote");
  url.searchParams.set("symbols", symbols.join(","));
  const upstream = await fetch(url, {
    headers: {
      "accept": "application/json,text/plain,*/*",
      "user-agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/120 Safari/537.36",
    },
  });
  if (!upstream.ok) throw new Error(`Yahoo Finance quote 返回 HTTP ${upstream.status}`);
  const body = await upstream.json();
  const quotes = body?.quoteResponse?.result || [];
  return quotes.map((quote) => ({
    symbol: quote.symbol,
    trailingPE: quote.trailingPE,
    forwardPE: quote.forwardPE,
    epsTrailingTwelveMonths: quote.epsTrailingTwelveMonths,
    marketCap: quote.marketCap,
    source: "Yahoo Finance quote API",
  }));
}

async function fetchFundamentalFallbacks(symbols, errors) {
  const rows = [];
  for (const symbol of symbols) {
    const quote =
      (await fetchAlphaOverview(symbol).catch((error) => {
        errors.push(error.message);
        return null;
      })) ||
      (await fetchFmpKeyMetrics(symbol).catch((error) => {
        errors.push(error.message);
        return null;
      })) ||
      (await fetchFinnhubMetrics(symbol).catch((error) => {
        errors.push(error.message);
        return null;
      }));
    if (quote) rows.push(quote);
  }
  return rows;
}

async function fetchAlphaOverview(symbol) {
  const apikey = process.env.ALPHA_VANTAGE_API_KEY || process.env.ALPHAVANTAGE_API_KEY;
  if (!apikey) throw new Error("Alpha Vantage API key 未配置");
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "OVERVIEW");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("apikey", apikey);
  const upstream = await fetch(url);
  if (!upstream.ok) throw new Error(`Alpha Vantage 返回 HTTP ${upstream.status}`);
  const body = await upstream.json();
  const pe = Number(body.PERatio);
  const forward = Number(body.ForwardPE);
  if (!Number.isFinite(pe) && !Number.isFinite(forward)) throw new Error(`Alpha Vantage 无 PE: ${symbol}`);
  return {
    symbol,
    trailingPE: Number.isFinite(pe) ? pe : undefined,
    forwardPE: Number.isFinite(forward) ? forward : undefined,
    marketCap: Number(body.MarketCapitalization) || undefined,
    source: "Alpha Vantage OVERVIEW",
  };
}

async function fetchFmpKeyMetrics(symbol) {
  const apikey = process.env.FMP_API_KEY || process.env.FINANCIAL_MODELING_PREP_API_KEY;
  if (!apikey) throw new Error("Financial Modeling Prep API key 未配置");
  const url = new URL("https://financialmodelingprep.com/stable/key-metrics-ttm");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("apikey", apikey);
  const upstream = await fetch(url);
  if (!upstream.ok) throw new Error(`FMP 返回 HTTP ${upstream.status}`);
  const body = await upstream.json();
  const row = Array.isArray(body) ? body[0] : body;
  const pe = Number(row?.peRatioTTM ?? row?.peRatio);
  if (!Number.isFinite(pe)) throw new Error(`FMP 无 PE: ${symbol}`);
  return {
    symbol,
    trailingPE: pe,
    source: "Financial Modeling Prep Key Metrics TTM",
  };
}

async function fetchFinnhubMetrics(symbol) {
  const token = process.env.FINNHUB_API_KEY || process.env.FINNHUB_TOKEN;
  if (!token) throw new Error("Finnhub API key 未配置");
  const url = new URL("https://finnhub.io/api/v1/stock/metric");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("metric", "all");
  url.searchParams.set("token", token);
  const upstream = await fetch(url);
  if (!upstream.ok) throw new Error(`Finnhub 返回 HTTP ${upstream.status}`);
  const body = await upstream.json();
  const metric = body?.metric || {};
  const pe = Number(metric.peNormalizedAnnual ?? metric.peBasicExclExtraTTM ?? metric.peTTM);
  if (!Number.isFinite(pe)) throw new Error(`Finnhub 无 PE: ${symbol}`);
  return {
    symbol,
    trailingPE: pe,
    source: "Finnhub Company Basic Financials",
  };
}

async function fetchFearGreed() {
  const key = "fear-greed";
  const cached = getCached(key, 5 * 60 * 1000);
  if (cached) return cached;

  const url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
  const upstream = await fetch(url, {
    headers: {
      "accept": "application/json,text/plain,*/*",
      "user-agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "referer": "https://www.cnn.com/markets/fear-and-greed",
    },
  });
  if (!upstream.ok) throw new Error(`CNN Fear & Greed 返回 HTTP ${upstream.status}`);
  const body = await upstream.json();
  const fg = body?.fear_and_greed;
  if (!fg) throw new Error("CNN Fear & Greed 没有返回指数");
  return setCached(key, {
    score: fg.score,
    rating: fg.rating,
    timestamp: fg.timestamp,
    source: "CNN Fear & Greed",
  });
}

async function handleHistory(req, res, url) {
  const symbols = parseSymbols(url.searchParams.get("symbols"));
  const range = url.searchParams.get("range") || "1y";
  const interval = url.searchParams.get("interval") || "1d";

  if (!symbols.length) return json(res, 400, { error: "缺少股票或指数代码" });
  if (!allowedRanges.has(range)) return json(res, 400, { error: "不支持的周期" });
  if (!allowedIntervals.has(interval)) return json(res, 400, { error: "不支持的时间粒度" });

  const series = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        return await fetchSymbol(symbol, range, interval);
      } catch (error) {
        return { symbol, error: error.message || "读取失败", points: [] };
      }
    }),
  );

  json(res, 200, {
    source: "Yahoo Finance chart API",
    range,
    interval,
    series,
  });
}

async function handleIndicators(req, res, url) {
  const symbols = parseSymbols(url.searchParams.get("symbols"));
  const result = { quotes: [], fearGreed: null, errors: {} };
  if (symbols.length) {
    try {
      result.quotes = await fetchQuote(symbols);
    } catch (error) {
      result.errors.quotes = error.message || "PE 数据读取失败";
    }
  }
  try {
    result.fearGreed = await fetchFearGreed();
  } catch (error) {
    result.errors.fearGreed = error.message || "恐慌贪婪指数读取失败";
  }
  json(res, 200, result);
}

function extractResponseText(body) {
  if (typeof body?.output_text === "string") return body.output_text;
  const parts = [];
  for (const item of body?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

async function handleGptAnalysis(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "只支持 POST" });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json(res, 400, { error: "未配置 OPENAI_API_KEY，无法调用 GPT 模型。" });
  }

  const payload = await readJsonBody(req);
  const model = process.env.OPENAI_MODEL || "gpt-5.2";
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "developer",
          content:
            "你是金融分析辅助模型。只能基于用户提供的结构化数据分析，不得编造行情、PE、新闻、财报或未来价格。输出中文，清楚区分事实、规则评分和不确定性。不要给保证收益的建议。",
        },
        {
          role: "user",
          content: `请分析这个标的。返回四段：1) 结论，2) 支撑依据，3) 风险，4) 需要补充的数据。\n\n数据：${JSON.stringify(payload)}`,
        },
      ],
      max_output_tokens: 700,
    }),
  });

  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return json(res, upstream.status, { error: body?.error?.message || `OpenAI 返回 HTTP ${upstream.status}` });
  }
  json(res, 200, { model, text: extractResponseText(body) || "GPT 没有返回文本。" });
}

async function serveStatic(req, res, url) {
  const rawPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(root, rawPath));
  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const data = await readFile(filePath);
  const type = mimeTypes[extname(filePath)] || "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "cache-control": "no-store",
  });
  res.end(data);
}

function createAppServer() {
  return createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/history") {
      await handleHistory(req, res, url);
      return;
    }
    if (url.pathname === "/api/indicators") {
      await handleIndicators(req, res, url);
      return;
    }
    if (url.pathname === "/api/gpt-analysis") {
      await handleGptAnalysis(req, res);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    json(res, 500, { error: error.message || "服务器错误" });
  }
  });
}

const server = createAppServer();
server.on("error", (error) => {
  console.error(error);
});
server.listen(port, host, () => {
  console.log(`同步走势已启动：http://${host}:${port}`);
});
