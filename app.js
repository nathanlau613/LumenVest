const palette = ["#88ad9d", "#5bd6a2", "#6fa8ff", "#ff7768", "#b58cff", "#46c7d8", "#e7a24d", "#d16fba"];
const symbolAliases = {
  "^GSPC": "S&P500",
  "^IXIC": "Nasdaq",
  "^DJI": "Dow",
  "^HSI": "Hang Seng",
  "000001.SS": "SSE Composite",
  "399001.SZ": "SZSE Component",
};
const inputAliases = {
  "S&P 500": "^GSPC",
  "S&P500": "^GSPC",
  SP500: "^GSPC",
  SPX: "^GSPC",
  NASDAQ: "^IXIC",
  "NASDAQ COMPOSITE": "^IXIC",
  IXIC: "^IXIC",
  DOW: "^DJI",
  "DOW JONES": "^DJI",
  DJIA: "^DJI",
  HSI: "^HSI",
  "HANG SENG": "^HSI",
  "恒生": "^HSI",
  "恒生指数": "^HSI",
  "上证": "000001.SS",
  "上证指数": "000001.SS",
  "深证成指": "399001.SZ",
};

const state = {
  range: "1y",
  interval: "1d",
  mode: "percent",
  symbols: ["AAPL", "MSFT", "^GSPC", "^IXIC"],
  series: [],
  fundamentals: {},
  fearGreed: null,
  indicatorErrors: {},
  hoverIndex: null,
};

const els = {
  form: document.getElementById("symbolForm"),
  input: document.getElementById("symbolInput"),
  chips: document.getElementById("symbolChips"),
  composer: document.getElementById("symbolComposer"),
  symbolCount: document.getElementById("symbolCount"),
  clearSymbols: document.getElementById("clearSymbols"),
  canvas: document.getElementById("chartCanvas"),
  tooltip: document.getElementById("tooltip"),
  empty: document.getElementById("emptyState"),
  list: document.getElementById("seriesList"),
  snapshot: document.getElementById("snapshotList"),
  status: document.getElementById("statusText"),
  pointCount: document.getElementById("pointCount"),
  chartTitle: document.getElementById("chartTitle"),
  chartSubtitle: document.getElementById("chartSubtitle"),
  hoverDate: document.getElementById("hoverDate"),
  aiSummary: document.getElementById("aiSummary"),
  aiSymbolSelect: document.getElementById("aiSymbolSelect"),
  aiModels: document.getElementById("aiModels"),
  gptAnalyze: document.getElementById("gptAnalyze"),
  gptStatus: document.getElementById("gptStatus"),
  gptOutput: document.getElementById("gptOutput"),
  fearGreedCard: document.getElementById("fearGreedCard"),
  techList: document.getElementById("techList"),
  saveWatchlist: document.getElementById("saveWatchlist"),
  loadWatchlist: document.getElementById("loadWatchlist"),
  watchSaved: document.getElementById("watchSaved"),
  watchStatus: document.getElementById("watchStatus"),
  holdingForm: document.getElementById("holdingForm"),
  holdingSymbol: document.getElementById("holdingSymbol"),
  holdingQty: document.getElementById("holdingQty"),
  holdingCost: document.getElementById("holdingCost"),
  portfolioList: document.getElementById("portfolioList"),
  minChangeFilter: document.getElementById("minChangeFilter"),
  screenerList: document.getElementById("screenerList"),
  generateReport: document.getElementById("generateReport"),
  reportOutput: document.getElementById("reportOutput"),
  leaderboardList: document.getElementById("leaderboardList"),
  settingsInfo: document.getElementById("settingsInfo"),
};

const ctx = els.canvas.getContext("2d");

function parseSymbols(value) {
  return replaceInputAliases(value)
    .split(/[,\s]+/)
    .map((item) => normalizeSymbol(item))
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index)
    .slice(0, 8);
}

function displaySymbol(symbol) {
  if (!symbol) return "";
  return symbolAliases[symbol] || symbol;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceInputAliases(value) {
  let text = String(value || "");
  Object.entries(inputAliases)
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([alias, symbol]) => {
      text = text.replace(new RegExp(`(^|[\\s,])${escapeRegExp(alias)}(?=$|[\\s,])`, "gi"), `$1${symbol}`);
    });
  return text;
}

function normalizeSymbol(value) {
  const token = String(value || "").trim().toUpperCase();
  if (/^\d{4}$/.test(token)) return `${token}.HK`;
  return inputAliases[token] || token;
}

function symbolMeta(symbol, suffix = "") {
  return suffix || displaySymbol(symbol);
}

function symbolLabel(symbol) {
  return escapeHtml(displaySymbol(symbol));
}

function setSymbols(symbols) {
  state.symbols = cleanSymbols(symbols);
  renderSymbolInput();
}

function cleanSymbols(symbols) {
  return (Array.isArray(symbols) ? symbols : [])
    .map((symbol) => normalizeSymbol(symbol))
    .filter(Boolean)
    .filter((symbol, index, all) => all.indexOf(symbol) === index)
    .slice(0, 8);
}

function addSymbols(value) {
  const incoming = parseSymbols(value);
  if (!incoming.length) return false;
  const merged = [...state.symbols];
  incoming.forEach((symbol) => {
    if (!merged.includes(symbol) && merged.length < 8) merged.push(symbol);
  });
  setSymbols(merged);
  els.input.value = "";
  return true;
}

function removeSymbol(symbol) {
  setSymbols(state.symbols.filter((item) => item !== symbol));
}

function refreshAfterSymbolChange(changed) {
  if (!changed) return;
  state.hoverIndex = null;
  loadData();
}

function renderSymbolInput() {
  els.chips.innerHTML = "";
  state.symbols.forEach((symbol) => {
    const chip = document.createElement("span");
    chip.className = "symbol-chip";
    chip.innerHTML = `${symbolLabel(symbol)} <button type="button" aria-label="移除 ${escapeHtml(symbol)}" data-remove-symbol="${escapeHtml(symbol)}">×</button>`;
    els.chips.appendChild(chip);
  });
  els.symbolCount.textContent = `${state.symbols.length}/8`;
  els.input.placeholder = state.symbols.length >= 8 ? "已达上限" : "代码/名称";
  els.input.disabled = state.symbols.length >= 8;
}

function formatDate(epochSeconds) {
  return new Intl.DateTimeFormat("zh-Hant", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: state.interval.endsWith("m") ? "2-digit" : undefined,
    minute: state.interval.endsWith("m") ? "2-digit" : undefined,
  }).format(new Date(epochSeconds * 1000));
}

function formatValue(value, mode = state.mode) {
  if (!Number.isFinite(value)) return "-";
  if (mode === "percent") return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function valueClass(value) {
  if (!Number.isFinite(value) || value === 0) return "";
  return value > 0 ? "positive" : "negative";
}

function lastDisplayValue(item) {
  const last = item?.display?.[item.display.length - 1];
  return last?.value;
}

function lastRawValue(item) {
  return item?.display?.[item.display.length - 1]?.raw;
}

function currentRawValue(item) {
  return Number.isFinite(item?.currentPrice) ? item.currentPrice : lastRawValue(item);
}

function average(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function stdDev(values) {
  const avg = average(values);
  if (!Number.isFinite(avg)) return null;
  const usable = values.filter(Number.isFinite);
  return Math.sqrt(average(usable.map((value) => (value - avg) ** 2)));
}

function calcRsi(points, period = 14) {
  if (points.length <= period) return null;
  const recent = points.slice(-period - 1);
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < recent.length; i += 1) {
    const diff = recent[i].close - recent[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function calcStats(item) {
  const closes = item.points?.map((point) => point.close).filter(Number.isFinite) || [];
  const returns = closes.slice(1).map((close, index) => ((close - closes[index]) / closes[index]) * 100);
  const last = closes.at(-1);
  const sma20 = average(closes.slice(-20));
  const sma50 = average(closes.slice(-50));
  const volatility = stdDev(returns.slice(-30));
  const support = closes.length ? Math.min(...closes.slice(-30)) : null;
  const resistance = closes.length ? Math.max(...closes.slice(-30)) : null;
  const rsi = calcRsi(item.points || []);
  return { last, sma20, sma50, volatility, support, resistance, rsi };
}

function scoreSeries(item) {
  const change = lastDisplayValue(item);
  const stats = calcStats(item);
  let score = 50;
  if (Number.isFinite(change)) score += Math.max(-25, Math.min(25, change * 0.7));
  if (Number.isFinite(stats.sma20) && Number.isFinite(stats.sma50)) score += stats.sma20 >= stats.sma50 ? 10 : -10;
  if (Number.isFinite(stats.rsi)) {
    if (stats.rsi < 30) score += 8;
    if (stats.rsi > 70) score -= 8;
  }
  if (Number.isFinite(stats.volatility) && stats.volatility > 4) score -= 5;
  const bounded = Math.max(0, Math.min(100, score));
  const action = bounded >= 62 ? "买入" : bounded <= 42 ? "观望" : "持有";
  return { score: bounded, action, stats };
}

function toDisplayPoints(points) {
  if (!points.length) return [];
  const first = points.find((point) => Number.isFinite(point.close));
  if (!first) return [];
  return points.map((point) => ({
    time: point.time,
    raw: point.close,
    value: state.mode === "percent" ? ((point.close - first.close) / first.close) * 100 : point.close,
  }));
}

function normalizeSeries(rawSeries) {
  return rawSeries.map((item, index) => ({
    ...item,
    color: palette[index % palette.length],
    display: item.error ? [] : toDisplayPoints(item.points),
  }));
}

async function loadData() {
  if (els.input.value.trim()) addSymbols(els.input.value);
  const symbols = state.symbols.slice(0, 8);
  if (!symbols.length) {
    state.series = [];
    state.hoverIndex = null;
    els.status.textContent = "待添加";
    els.empty.textContent = "请输入至少一个股票或指数代码。";
    els.empty.classList.remove("hidden");
    renderLists();
    renderChart();
    renderFeaturePanels();
    return;
  }

  state.series = symbols.map((symbol, index) => ({ symbol, color: palette[index % palette.length], points: [], display: [] }));
  renderLists();
  setLoading(`读取 ${symbols.length} 个标的`);

  try {
    const params = new URLSearchParams({
      symbols: symbols.join(","),
      range: state.range,
      interval: state.interval,
    });
    const res = await fetch(`/api/history?${params.toString()}`);
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    state.series = normalizeSeries(payload.series || []);
    await loadIndicators(symbols);
    state.hoverIndex = null;
    updateHead();
    renderLists();
    renderChart();
    renderFeaturePanels();
    const okCount = state.series.filter((item) => !item.error && item.display.length).length;
    els.status.textContent = `${okCount}/${state.series.length} 已载入`;
  } catch (error) {
    showError(error.message || "读取失败");
  }
}

async function loadIndicators(symbols) {
  state.fundamentals = {};
  state.fearGreed = null;
  state.indicatorErrors = {};
  try {
    const params = new URLSearchParams({ symbols: symbols.join(",") });
    const res = await fetch(`/api/indicators?${params.toString()}`);
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    state.fundamentals = Object.fromEntries((payload.quotes || []).map((quote) => [quote.symbol, quote]));
    state.fearGreed = payload.fearGreed || null;
    state.indicatorErrors = payload.errors || {};
  } catch (error) {
    state.indicatorErrors = { indicators: error.message || "指标读取失败" };
  }
}

function setLoading(text) {
  els.status.textContent = text;
  els.empty.textContent = "正在读取数据";
  els.empty.classList.remove("hidden");
}

function showError(message) {
  state.series = state.series.map((item) => ({ ...item, error: message }));
  els.status.textContent = "读取失败";
  els.empty.textContent = message;
  els.empty.classList.remove("hidden");
  renderLists();
  renderSnapshot();
  renderFeaturePanels();
}

function updateHead() {
  const isPercent = state.mode === "percent";
  els.chartTitle.textContent = isPercent ? "归一化走势" : "原始价格走势";
  els.chartSubtitle.textContent = isPercent ? "共同时间轴，起点为 0%" : "共同时间轴，不同币种或指数点位不做换算";
}

function getAllDisplayPoints() {
  return state.series.flatMap((item) => item.display);
}

function getDomain() {
  const points = getAllDisplayPoints();
  const times = points.map((point) => point.time);
  const values = points.map((point) => point.value).filter(Number.isFinite);
  if (!times.length || !values.length) return null;
  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);
  if (minValue === maxValue) {
    minValue -= 1;
    maxValue += 1;
  }
  const pad = (maxValue - minValue) * 0.12;
  return {
    minTime: Math.min(...times),
    maxTime: Math.max(...times),
    minValue: minValue - pad,
    maxValue: maxValue + pad,
  };
}

function chartBox() {
  const rect = els.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (els.canvas.width !== Math.round(rect.width * dpr) || els.canvas.height !== Math.round(rect.height * dpr)) {
    els.canvas.width = Math.round(rect.width * dpr);
    els.canvas.height = Math.round(rect.height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return {
    width: rect.width,
    height: rect.height,
    left: 54,
    right: 18,
    top: 24,
    bottom: 36,
  };
}

function xScale(time, domain, box) {
  const span = domain.maxTime - domain.minTime || 1;
  return box.left + ((time - domain.minTime) / span) * (box.width - box.left - box.right);
}

function yScale(value, domain, box) {
  const span = domain.maxValue - domain.minValue || 1;
  return box.top + (1 - (value - domain.minValue) / span) * (box.height - box.top - box.bottom);
}

function drawAxes(domain, box) {
  ctx.clearRect(0, 0, box.width, box.height);
  ctx.strokeStyle = "rgba(73, 116, 98, 0.2)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "rgba(245, 239, 224, 0.62)";
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= 4; i += 1) {
    const y = box.top + ((box.height - box.top - box.bottom) * i) / 4;
    const value = domain.maxValue - ((domain.maxValue - domain.minValue) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(box.left, y);
    ctx.lineTo(box.width - box.right, y);
    ctx.stroke();
    ctx.fillText(formatValue(value), 8, y);
  }

  ctx.textBaseline = "alphabetic";
  for (let i = 0; i <= 4; i += 1) {
    const x = box.left + ((box.width - box.left - box.right) * i) / 4;
    const time = domain.minTime + ((domain.maxTime - domain.minTime) * i) / 4;
    const label = new Intl.DateTimeFormat("zh-Hant", { month: "2-digit", day: "2-digit" }).format(new Date(time * 1000));
    ctx.fillText(label, Math.min(x, box.width - 56), box.height - 12);
  }
}

function drawSeries(domain, box) {
  state.series.forEach((item) => {
    if (!item.display.length) return;
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    item.display.forEach((point, index) => {
      const x = xScale(point.time, domain, box);
      const y = yScale(point.value, domain, box);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}

function drawHover(domain, box) {
  if (state.hoverIndex === null) return;
  const hover = getHoverRows(state.hoverIndex);
  if (!hover.length) return;
  const first = hover[0].point;
  const x = xScale(first.time, domain, box);
  ctx.strokeStyle = "rgba(136, 173, 157, 0.56)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, box.top);
  ctx.lineTo(x, box.height - box.bottom);
  ctx.stroke();

  hover.forEach(({ item, point }) => {
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(xScale(point.time, domain, box), yScale(point.value, domain, box), 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function renderChart() {
  updateHead();
  const domain = getDomain();
  const box = chartBox();
  ctx.clearRect(0, 0, box.width, box.height);
  if (!domain) {
    els.empty.textContent = state.series.some((item) => item.error) ? "没有可绘制的数据" : "暂无数据";
    els.empty.classList.remove("hidden");
    renderSnapshot();
    return;
  }
  els.empty.classList.add("hidden");
  drawAxes(domain, box);
  drawSeries(domain, box);
  drawHover(domain, box);
  renderSnapshot();
  els.pointCount.textContent = `${getAllDisplayPoints().length} 点`;
}

function renderLists() {
  els.list.innerHTML = "";
  state.series.forEach((item) => {
    const last = item.display[item.display.length - 1];
    const currentPrice = currentRawValue(item);
    const row = document.createElement("div");
    row.className = "series-row";
    row.innerHTML = `
      <div class="series-main">
        <span class="swatch" style="background:${item.color}"></span>
        <div>
          <div class="symbol-name">${escapeHtml(displaySymbol(item.symbol))}</div>
          <div class="series-meta">${escapeHtml(symbolMeta(item.symbol, `现价 ${formatValue(currentPrice, "price")}`))}</div>
        </div>
        <div class="series-change ${valueClass(last?.value)}">${last ? formatValue(last.value) : "-"}</div>
      </div>
      ${item.error ? `<div class="series-error">${escapeHtml(item.error)}</div>` : ""}
    `;
    els.list.appendChild(row);
  });
  renderSnapshot();
}

function loadedSeries() {
  return state.series.filter((item) => !item.error && item.display.length);
}

function renderFeaturePanels() {
  const renderers = [renderAiPanel, renderTechPanel, renderWatchPanel, renderPortfolio, renderScreener, renderLeaderboard, renderSettings];
  renderers.forEach((render) => {
    try {
      render();
    } catch (error) {
      console.warn("功能模块渲染失败", error);
    }
  });
}

function renderAiPanel() {
  const entries = loadedSeries().map((item) => ({ item, ...scoreSeries(item) })).sort((a, b) => b.score - a.score);
  const selectedSymbol = els.aiSymbolSelect.value;
  const selected = entries.find((entry) => entry.item.symbol === selectedSymbol) || entries[0];
  els.aiSymbolSelect.innerHTML = loadedSeries()
    .map((item) => `<option value="${escapeHtml(item.symbol)}">${escapeHtml(displaySymbol(item.symbol))}</option>`)
    .join("");
  if (selected) els.aiSymbolSelect.value = selected.item.symbol;
  if (!selected) {
    els.aiSummary.textContent = "等待行情载入。";
    els.aiModels.innerHTML = "";
    return;
  }
  els.aiSummary.innerHTML = `
    <small>${escapeHtml(displaySymbol(selected.item.symbol))}</small>
    <strong>${escapeHtml(selected.action)}</strong>
    <small>置信度 ${selected.score.toFixed(0)} / 100。该结果来自本地规则模型：涨跌幅、均线、RSI 和波动率。</small>
  `;
  const models = [
    ["趋势模型", selected.stats.sma20 >= selected.stats.sma50 ? "偏多" : "偏弱", "比较 20 日均线和 50 日均线。"],
    ["动量模型", formatValue(lastDisplayValue(selected.item)), "使用当前周期归一化表现。"],
    ["风险模型", Number.isFinite(selected.stats.volatility) ? `${selected.stats.volatility.toFixed(2)}%` : "-", "基于近 30 个收益率的波动。"],
  ];
  els.aiModels.innerHTML = models
    .map(([name, value, note]) => `<div class="model-card"><strong>${escapeHtml(name)} · ${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div>`)
    .join("");
}

function selectedAiEntry() {
  const entries = loadedSeries().map((item) => ({ item, ...scoreSeries(item) })).sort((a, b) => b.score - a.score);
  return entries.find((entry) => entry.item.symbol === els.aiSymbolSelect.value) || entries[0] || null;
}

function buildGptPayload(entry) {
  const item = entry.item;
  const quote = state.fundamentals[item.symbol] || {};
  const pe = Number.isFinite(quote.trailingPE) ? quote.trailingPE : quote.forwardPE;
  return {
    symbol: item.symbol,
    name: displaySymbol(item.symbol),
    range: state.range,
    interval: state.interval,
    currentPrice: currentRawValue(item),
    periodChangePercent: lastDisplayValue(item),
    ruleModel: {
      action: entry.action,
      score: Number(entry.score.toFixed(2)),
      scoringLogic: "50 base; period change capped at +/-25; MA20 vs MA50 +/-10; RSI oversold +8 / overbought -8; volatility over 4% subtracts 5.",
    },
    technicals: {
      rsi: entry.stats.rsi,
      ma20: entry.stats.sma20,
      ma50: entry.stats.sma50,
      support30: entry.stats.support,
      resistance30: entry.stats.resistance,
      volatility30: entry.stats.volatility,
    },
    valuation: {
      pe: Number.isFinite(pe) ? pe : null,
      peSource: quote.source || null,
    },
    sentiment: {
      fearGreed: state.fearGreed,
      errors: state.indicatorErrors,
    },
  };
}

async function runGptAnalysis() {
  const entry = selectedAiEntry();
  if (!entry) {
    els.gptOutput.textContent = "请先载入至少一个标的。";
    return;
  }
  els.gptStatus.textContent = "GPT 分析中";
  els.gptAnalyze.disabled = true;
  try {
    const res = await fetch("/api/gpt-analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildGptPayload(entry)),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    els.gptStatus.textContent = `模型：${payload.model}`;
    els.gptOutput.textContent = payload.text;
  } catch (error) {
    els.gptStatus.textContent = "GPT 不可用";
    els.gptOutput.textContent = error.message || "GPT 分析失败";
  } finally {
    els.gptAnalyze.disabled = false;
  }
}

function renderTechPanel() {
  renderFearGreed();
  els.techList.innerHTML = loadedSeries()
    .map((item) => {
      const stats = calcStats(item);
      const quote = state.fundamentals[item.symbol] || {};
      const pe = Number.isFinite(quote.trailingPE) ? quote.trailingPE : quote.forwardPE;
      const peLabel = Number.isFinite(pe) ? pe.toFixed(2) : "不可用";
      return `<div class="data-row">
        <strong>${escapeHtml(displaySymbol(item.symbol))}</strong>
        <small>PE ${escapeHtml(peLabel)} · RSI ${Number.isFinite(stats.rsi) ? stats.rsi.toFixed(1) : "-"} · MA20 ${formatValue(stats.sma20, "price")} · MA50 ${formatValue(stats.sma50, "price")}</small>
        <small>支撑 ${formatValue(stats.support, "price")} · 压力 ${formatValue(stats.resistance, "price")} · 波动 ${Number.isFinite(stats.volatility) ? `${stats.volatility.toFixed(2)}%` : "-"}</small>
      </div>`;
    })
    .join("") || `<div class="data-row"><strong>等待行情</strong><small>载入标的后显示技术指标。</small></div>`;
}

function renderFearGreed() {
  const fg = state.fearGreed;
  if (!fg) {
    const reason = state.indicatorErrors.fearGreed || "数据源当前不可用";
    els.fearGreedCard.innerHTML = `<small>恐慌贪婪指数</small><strong>不可用</strong><small>${escapeHtml(reason)}</small>`;
    return;
  }
  const score = Number(fg.score);
  const time = fg.timestamp ? new Date(fg.timestamp).toLocaleString("zh-Hant") : "";
  els.fearGreedCard.innerHTML = `
    <small>恐慌贪婪指数 · ${escapeHtml(fg.source || "CNN Fear & Greed")}</small>
    <strong>${Number.isFinite(score) ? score.toFixed(0) : "-"}</strong>
    <small>${escapeHtml(fg.rating || "未分类")}${time ? ` · ${escapeHtml(time)}` : ""}</small>
  `;
}

function savedWatchlist() {
  try {
    return cleanSymbols(JSON.parse(localStorage.getItem("stockSyncWatchlist") || "[]"));
  } catch {
    return [];
  }
}

function saveWatchlist() {
  localStorage.setItem("stockSyncWatchlist", JSON.stringify(state.symbols));
  els.watchStatus.textContent = "已保存";
  renderWatchPanel();
}

function renderWatchPanel() {
  const saved = savedWatchlist();
  els.watchSaved.innerHTML = saved.length
    ? saved.map((symbol) => `<div class="data-row"><strong>${escapeHtml(displaySymbol(symbol))}</strong><small>已保存</small></div>`).join("")
    : `<div class="data-row"><strong>未保存自选</strong><small>点击“保存当前标的”会写入本机浏览器。</small></div>`;
}

function holdings() {
  try {
    return cleanHoldings(JSON.parse(localStorage.getItem("stockSyncHoldings") || "[]"));
  } catch {
    return [];
  }
}

function setHoldings(rows) {
  localStorage.setItem("stockSyncHoldings", JSON.stringify(cleanHoldings(rows)));
}

function cleanHoldings(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      symbol: normalizeSymbol(row?.symbol),
      qty: Number(row?.qty),
      cost: Number(row?.cost),
    }))
    .filter((row) => row.symbol && Number.isFinite(row.qty) && row.qty > 0 && Number.isFinite(row.cost) && row.cost >= 0);
}

function addHolding(event) {
  event.preventDefault();
  const symbol = normalizeSymbol(els.holdingSymbol.value);
  const qty = Number(els.holdingQty.value);
  const cost = Number(els.holdingCost.value);
  if (!symbol || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(cost) || cost < 0) return;
  setHoldings([...holdings(), { symbol, qty, cost }]);
  els.holdingSymbol.value = "";
  els.holdingQty.value = "";
  els.holdingCost.value = "";
  if (!state.symbols.includes(symbol)) setSymbols([...state.symbols, symbol]);
  loadData();
}

function renderPortfolio() {
  const rows = holdings();
  if (!rows.length) {
    els.portfolioList.innerHTML = `<div class="data-row"><strong>暂无持仓</strong><small>输入代码、数量和成本价后会按当前行情估值。</small></div>`;
    return;
  }
  els.portfolioList.innerHTML = rows
    .map((row, index) => {
      const item = state.series.find((series) => series.symbol === row.symbol);
      const price = currentRawValue(item);
      const marketValue = Number.isFinite(price) ? price * row.qty : null;
      const pnl = Number.isFinite(marketValue) ? marketValue - row.cost * row.qty : null;
      return `<div class="data-row">
        <strong>${escapeHtml(displaySymbol(row.symbol))}</strong>
        <small>数量 ${row.qty} · 成本 ${formatValue(row.cost, "price")} · 现价 ${formatValue(price, "price")}</small>
        <small class="${valueClass(pnl)}">市值 ${formatValue(marketValue, "price")} · 盈亏 ${formatValue(pnl, "price")} <button type="button" data-remove-holding="${index}">删除</button></small>
      </div>`;
    })
    .join("");
}

function renderScreener() {
  const min = Number(els.minChangeFilter.value);
  const rows = loadedSeries()
    .map((item) => ({ item, change: lastDisplayValue(item), score: scoreSeries(item).score }))
    .filter((entry) => !Number.isFinite(min) || entry.change >= min)
    .sort((a, b) => b.change - a.change);
  els.screenerList.innerHTML = rows
    .map((entry) => `<div class="data-row"><strong>${escapeHtml(displaySymbol(entry.item.symbol))}</strong><small class="${valueClass(entry.change)}">涨跌 ${formatValue(entry.change)} · AI 分 ${entry.score.toFixed(0)}</small></div>`)
    .join("") || `<div class="data-row"><strong>没有符合条件的标的</strong><small>调低最低涨跌幅或添加更多标的。</small></div>`;
}

function renderLeaderboard() {
  const rows = loadedSeries()
    .map((item) => ({ item, ...scoreSeries(item) }))
    .sort((a, b) => b.score - a.score);
  els.leaderboardList.innerHTML = rows
    .map(
      (entry, index) => `<div class="data-row">
        <strong>#${index + 1} ${escapeHtml(displaySymbol(entry.item.symbol))}</strong>
        <small>${escapeHtml(entry.action)} · AI 分 ${entry.score.toFixed(0)} · 表现 ${formatValue(lastDisplayValue(entry.item))}</small>
      </div>`,
    )
    .join("") || `<div class="data-row"><strong>等待行情</strong><small>载入标的后生成排行榜。</small></div>`;
}

function buildReport() {
  const lines = [
    `同步走势报告`,
    `生成时间：${new Date().toLocaleString("zh-Hant")}`,
    `周期：${state.range} / ${state.interval}`,
    "",
    ...loadedSeries().map((item) => {
      const score = scoreSeries(item);
      const stats = score.stats;
      const quote = state.fundamentals[item.symbol] || {};
      const pe = Number.isFinite(quote.trailingPE) ? quote.trailingPE : quote.forwardPE;
      return `${displaySymbol(item.symbol)}：表现 ${formatValue(lastDisplayValue(item))}，现价 ${formatValue(currentRawValue(item), "price")}，PE ${Number.isFinite(pe) ? pe.toFixed(2) : "不可用"}，AI 观点 ${score.action}(${score.score.toFixed(0)}/100)，RSI ${Number.isFinite(stats.rsi) ? stats.rsi.toFixed(1) : "-"}`;
    }),
    "",
    `恐慌贪婪指数：${state.fearGreed ? `${state.fearGreed.score} (${state.fearGreed.rating || "未分类"})` : "不可用"}`,
  ];
  return lines.join("\n");
}

function generateReport() {
  const report = buildReport();
  els.reportOutput.value = report;
  const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `stock-sync-report-${Date.now()}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

function renderSettings() {
  els.settingsInfo.innerHTML = `
    <div class="data-row"><strong>数据源</strong><small>Yahoo Finance chart API，经本地服务代理读取。</small></div>
    <div class="data-row"><strong>PE 备用路径</strong><small>支持环境变量：ALPHA_VANTAGE_API_KEY、FMP_API_KEY、FINNHUB_API_KEY。未配置时显示不可用。</small></div>
    <div class="data-row"><strong>行情缓存</strong><small>服务端 60 秒缓存；页面不生成模拟行情。</small></div>
    <div class="data-row"><strong>本地数据</strong><small>自选列表和投资组合保存在当前浏览器 localStorage。</small></div>
  `;
}

function nearestIndexByX(clientX) {
  const domain = getDomain();
  if (!domain) return null;
  const box = chartBox();
  const rect = els.canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, (x - box.left) / (box.width - box.left - box.right)));
  const target = domain.minTime + ratio * (domain.maxTime - domain.minTime);
  const base = state.series.find((item) => item.display.length)?.display || [];
  if (!base.length) return null;
  let bestIndex = 0;
  let bestDistance = Infinity;
  base.forEach((point, index) => {
    const distance = Math.abs(point.time - target);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });
  return bestIndex;
}

function getHoverRows(index) {
  return state.series
    .map((item) => {
      if (!item.display.length) return null;
      const point = item.display[Math.min(index, item.display.length - 1)];
      return point ? { item, point } : null;
    })
    .filter(Boolean);
}

function renderSnapshot() {
  const domain = getDomain();
  const fallbackIndex = domain ? Math.max(...state.series.map((item) => item.display.length - 1).filter((value) => value >= 0)) : null;
  const index = state.hoverIndex ?? fallbackIndex;
  const rows = Number.isFinite(index) ? getHoverRows(index) : [];
  els.snapshot.innerHTML = "";
  els.hoverDate.textContent = rows[0] ? formatDate(rows[0].point.time) : "-";
  rows.forEach(({ item, point }) => {
    const row = document.createElement("div");
    row.className = "snapshot-row";
    row.innerHTML = `
      <span class="swatch" style="background:${item.color}"></span>
      <div>
        <div class="symbol-name">${escapeHtml(displaySymbol(item.symbol))}</div>
        <div class="snapshot-meta">${escapeHtml(symbolMeta(item.symbol, formatValue(point.raw, "price")))}</div>
      </div>
      <div class="series-change ${valueClass(point.value)}">${formatValue(point.value)}</div>
    `;
    els.snapshot.appendChild(row);
  });
}

function renderTooltip(clientX, clientY) {
  const rows = getHoverRows(state.hoverIndex);
  if (!rows.length) {
    els.tooltip.hidden = true;
    return;
  }
  els.tooltip.innerHTML = `
    <strong>${formatDate(rows[0].point.time)}</strong>
    ${rows
      .map(
        ({ item, point }) =>
          `<div class="tooltip-line"><span>${escapeHtml(displaySymbol(item.symbol))}</span><span>${formatValue(point.value)}</span></div>`,
      )
      .join("")}
  `;
  const wrap = els.canvas.parentElement.getBoundingClientRect();
  const x = clientX - wrap.left;
  const y = clientY - wrap.top;
  els.tooltip.style.left = `${Math.min(x + 14, wrap.width - 276)}px`;
  els.tooltip.style.top = `${Math.max(10, y - 18)}px`;
  els.tooltip.hidden = false;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char];
  });
}

document.querySelectorAll("[data-range]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-range]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.range = button.dataset.range;
    state.interval = button.dataset.interval;
    loadData();
  });
});

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-mode]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.mode = button.dataset.mode;
    state.series = normalizeSeries(state.series);
    state.hoverIndex = null;
    renderLists();
    renderChart();
    renderFeaturePanels();
  });
});

els.chips.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-symbol]");
  if (!button) return;
  removeSymbol(button.dataset.removeSymbol);
  els.input.disabled = false;
  els.input.focus();
  loadData();
});

els.composer.addEventListener("click", () => {
  if (!els.input.disabled) els.input.focus();
});

els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === ",") {
    if (els.input.value.trim()) {
      event.preventDefault();
      refreshAfterSymbolChange(addSymbols(els.input.value));
    }
  }
  if (event.key === "Backspace" && !els.input.value && state.symbols.length) {
    removeSymbol(state.symbols[state.symbols.length - 1]);
    loadData();
  }
});

els.input.addEventListener("paste", () => {
  window.setTimeout(() => refreshAfterSymbolChange(addSymbols(els.input.value)), 0);
});

document.querySelectorAll("[data-symbol]").forEach((button) => {
  button.addEventListener("click", () => {
    refreshAfterSymbolChange(addSymbols(button.dataset.symbol));
  });
});

els.clearSymbols.addEventListener("click", () => {
  setSymbols([]);
  els.input.disabled = false;
  els.input.focus();
  loadData();
});

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadData();
});

document.querySelectorAll(".nav-list a").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-list a").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
});

els.saveWatchlist.addEventListener("click", saveWatchlist);

els.loadWatchlist.addEventListener("click", () => {
  const saved = savedWatchlist();
  if (!saved.length) return;
  setSymbols(saved);
  loadData();
});

els.holdingForm.addEventListener("submit", addHolding);

els.portfolioList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-holding]");
  if (!button) return;
  const rows = holdings();
  rows.splice(Number(button.dataset.removeHolding), 1);
  setHoldings(rows);
  renderPortfolio();
});

els.minChangeFilter.addEventListener("input", renderScreener);
els.aiSymbolSelect.addEventListener("change", renderAiPanel);
els.gptAnalyze.addEventListener("click", runGptAnalysis);
els.generateReport.addEventListener("click", generateReport);

els.canvas.addEventListener("pointermove", (event) => {
  const index = nearestIndexByX(event.clientX);
  if (index === null) return;
  state.hoverIndex = index;
  renderChart();
  renderTooltip(event.clientX, event.clientY);
});

els.canvas.addEventListener("pointerleave", () => {
  state.hoverIndex = null;
  els.tooltip.hidden = true;
  renderChart();
});

window.addEventListener("resize", () => renderChart());

renderSymbolInput();
renderFeaturePanels();
loadData();
