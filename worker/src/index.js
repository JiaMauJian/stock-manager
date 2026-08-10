/**
 * 持股管理 Worker
 *
 * 兩組路由：
 *   GET  /?symbols=2330,0050   股價查詢（Yahoo）
 *   GET  /portfolio?key=<同步碼>  取回雲端持股
 *   PUT  /portfolio?key=<同步碼>  上傳持股
 *
 * 注意：如果你想保留原本那支 Worker 的股價實作，只要把下面
 * 「同步（KV）」那一段搬過去、並在 fetch 裡加上 /portfolio 的分流即可。
 */

const SYNC_PATH = "/portfolio";
const MAX_BODY_BYTES = 64 * 1024;
const SYNC_CODE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === SYNC_PATH) {
        return await handleSync(request, url, env, origin);
      }
      if (request.method === "GET") {
        return await handlePrices(url, origin);
      }
      return fail("Method not allowed", 405, origin);
    } catch (error) {
      return fail(error.message || "Unexpected error", 500, origin);
    }
  },
};

/* ------------------------------------------------------------------ */
/* 同步（KV）                                                          */
/* ------------------------------------------------------------------ */

async function handleSync(request, url, env, origin) {
  if (!env.PORTFOLIO) {
    return fail("KV namespace 未綁定", 500, origin);
  }

  const code = String(url.searchParams.get("key") || "").trim();
  if (!SYNC_CODE_PATTERN.test(code)) {
    return fail("同步碼格式錯誤", 400, origin);
  }
  const kvKey = `portfolio:${code}`;

  if (request.method === "GET") {
    const stored = await env.PORTFOLIO.get(kvKey);
    if (!stored) return fail("雲端還沒有這組同步碼的資料", 404, origin);
    return ok(JSON.parse(stored), origin);
  }

  if (request.method === "PUT") {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return fail("資料過大", 413, origin);
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail("JSON 格式錯誤", 400, origin);
    }
    if (!body || typeof body !== "object" || !body.portfolio) {
      return fail("缺少 portfolio 欄位", 400, origin);
    }

    const record = {
      portfolio: body.portfolio,
      updatedAt: new Date().toISOString(),
      device: String(body.device || "").slice(0, 60),
    };
    await env.PORTFOLIO.put(kvKey, JSON.stringify(record));
    return ok({ updatedAt: record.updatedAt }, origin);
  }

  return fail("Method not allowed", 405, origin);
}

/* ------------------------------------------------------------------ */
/* 股價（Yahoo）                                                       */
/* ------------------------------------------------------------------ */

async function handlePrices(url, origin) {
  const symbols = String(url.searchParams.get("symbols") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 50);

  if (!symbols.length) return fail("Missing symbols", 400, origin);

  const prices = {};
  const missing = [];

  const results = await Promise.all(
    symbols.map(async (symbol) => ({ symbol, quote: await lookupQuote(symbol) })),
  );

  for (const { symbol, quote } of results) {
    if (!quote) {
      missing.push(symbol);
      continue;
    }
    prices[symbol] = quote.price;
    prices[quote.ticker] = quote.price;
  }

  return ok({ source: "yahoo", updatedAt: new Date().toISOString(), prices, missing }, origin);
}

async function lookupQuote(symbol) {
  for (const ticker of candidateTickers(symbol)) {
    const price = await fetchYahooPrice(ticker);
    if (price != null) return { ticker, price };
  }
  return null;
}

// 純數字視為台股，先試上市（.TW）再試上櫃（.TWO）；其餘直接照原樣查。
function candidateTickers(symbol) {
  if (/^\d{4,6}[A-Z]?$/i.test(symbol)) return [`${symbol}.TW`, `${symbol}.TWO`];
  return [symbol];
}

async function fetchYahooPrice(ticker) {
  const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
  const response = await fetch(endpoint, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!response.ok) return null;

  const data = await response.json();
  const meta = data?.chart?.result?.[0]?.meta;
  const price = Number(meta?.regularMarketPrice ?? meta?.previousClose);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/* ------------------------------------------------------------------ */
/* 共用                                                                */
/* ------------------------------------------------------------------ */

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

function ok(payload, origin) {
  return json({ ok: true, ...payload }, 200, origin);
}

function fail(error, status, origin) {
  return json({ ok: false, error }, status, origin);
}

function json(payload, status, origin) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) },
  });
}
