# 同步走势 App

本地网页应用，用于输入多个股票或指数代码，并在同一时间轴上同步显示走势。

## 运行

```bash
/Users/nathanlau/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.mjs
```

然后打开：

```text
http://localhost:4173
```

也可以使用部署平台通用命令：

```bash
npm start
```

## 正式上线

项目已经补好 Node 部署所需文件：

- `package.json`
- `render.yaml`
- `.gitignore`

Render 上线步骤：

1. 把本目录上传到 GitHub 仓库。
2. 在 Render 新建 Web Service。
3. 连接 GitHub 仓库。
4. Build Command 留空。
5. Start Command 使用 `npm start`。
6. 部署完成后，Render 会生成公网网址。

如果需要 GPT 解读，在 Render 的 Environment 里配置：

```text
OPENAI_API_KEY=你的 key
OPENAI_MODEL=gpt-5.2
```

## 数据说明

- 当前数据源：Yahoo Finance chart API。
- 页面不生成模拟行情；如果接口没有返回数据，会显示错误。
- 默认示例：`AAPL, MSFT, ^GSPC, ^IXIC`。
- PE 值优先读取 Yahoo Finance quote API；如果被限流，可配置备用 API key：
  - `ALPHA_VANTAGE_API_KEY`
  - `FMP_API_KEY`
  - `FINNHUB_API_KEY`
- 恐慌贪婪指数读取 CNN Fear & Greed 数据；读取失败时显示不可用。
- GPT 解读需要配置 OpenAI API key：
  - `OPENAI_API_KEY`
  - 可选：`OPENAI_MODEL`，默认 `gpt-5.2`

## 已有功能

- 输入 1 到 8 个股票或指数代码。
- 周期切换：5D、1M、6M、YTD、1Y、5Y。
- 显示方式切换：百分比走势、原始价格。
- 鼠标悬停时同步显示每个标的在同一时间点的读数。
- 后端做 60 秒缓存，减少重复请求。
