import {
  autoCalculateOrders,
  clearOrders,
  computePortfolio,
  createDefaultPortfolio,
  initializeOrders,
  normalizePortfolio,
} from "./portfolio-engine.js";

const STORE_KEY = "holdings-mobile-portfolio-v1";
const app = document.querySelector("#app");
let portfolio = loadPortfolio();

render();
wireEvents();

function render() {
  const computed = computePortfolio(portfolio);
  app.innerHTML = `
    ${renderNotice(computed.validation)}
    ${renderAccount(computed)}
    ${renderHoldings(computed)}
    ${renderRebalance(computed)}
    ${renderSummary(computed)}
    ${renderPosition(computed)}
    ${renderStatus(computed)}
    ${renderOrders(computed)}
    ${renderDataTools()}
  `;
}

function renderAccount(computed) {
  return `
    <section class="sheet-block area-account">
      <div class="sheet-title">帳戶資料</div>
      <div class="table-wrap">
        <table class="account-table">
          <tbody>
            ${editableRow("帳號姓名", "account.name", computed.account.name, "text", "text")}
            ${editableRow("帳號代碼", "account.code", computed.account.code, "text", "text")}
            ${editablePercentRow("手續費率", "account.feeRate", computed.account.feeRate, 4)}
            ${editableRow("原始資金", "account.initialCapital", computed.account.initialCapital, "integer")}
            ${editableRow("今年股本", "account.yearlyCapital", computed.account.yearlyCapital, "integer")}
            ${editableRow("現金餘額", "account.cash", computed.account.cash, "number")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderHoldings() {
  return `
    <section class="sheet-block area-holdings">
      <div class="action-row">
        <button class="excel-button" type="button" data-action="sort-holdings">代號排序</button>
        <button class="excel-button" type="button" data-action="update-prices">更新</button>
      </div>
      <div class="sheet-title">持股資料</div>
      <div class="table-wrap">
        <table class="holdings-table">
          <thead>
            <tr>
              <th class="name-cell">股票名稱(代號)</th>
              <th>股數</th>
              <th>成本</th>
              <th>現金股利</th>
              <th>股票股利</th>
              <th>股價</th>
              <th>編輯</th>
            </tr>
          </thead>
          <tbody>
            ${portfolio.holdings
              .map(
                (row, index) => `
                  <tr>
                    ${editableCell(`holdings.${index}.symbol`, row.symbol, "text", "name-cell")}
                    ${editableCell(`holdings.${index}.shares`, row.shares, "integer", "number-cell")}
                    ${editableCell(`holdings.${index}.cost`, row.cost, "number", "number-cell", "0.01")}
                    ${editableCell(`holdings.${index}.cashDividend`, row.cashDividend, "number", "number-cell", "0.01")}
                    ${editableCell(`holdings.${index}.stockDividend`, row.stockDividend, "number", "number-cell", "0.01")}
                    ${editableCell(`holdings.${index}.price`, row.price, "number", "number-cell", "0.01")}
                    <td class="result-cell action-cell">
                      <button class="row-button" type="button" data-action="clear-holding" data-index="${index}">清除</button>
                    </td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRebalance(computed) {
  return `
    <section class="sheet-block area-rebalance">
      <div class="action-row">
        <button class="excel-button" type="button" data-action="auto-orders">自動計算</button>
      </div>
      <div class="sheet-title">加減碼試算</div>
      <div class="table-wrap">
        <table class="rebalance-table">
          <thead>
            <tr>
              <th class="name-cell">持股</th>
              <th>預計比重</th>
              <th>加買金額</th>
              <th>加買股數</th>
            </tr>
          </thead>
          <tbody>
            ${computed.quickOrders
              .map((row, index) => {
                const holding = computed.holdings[index];
                return `
                  <tr>
                    <td class="result-cell name-cell">${escapeHtml(holding.symbol)}</td>
                    ${editablePercentCell(`holdings.${index}.targetWeight`, holding.targetWeight, 1)}
                    <td class="result-cell number-cell">${money(row.amount)}</td>
                    <td class="result-cell number-cell">${number(row.quantity)}</td>
                  </tr>
                `;
              })
              .join("")}
            <tr>
              <td class="result-cell total-label">總計</td>
              <td class="result-cell"></td>
              <td class="result-cell number-cell">${money(sum(computed.quickOrders.map((row) => row.amount || 0)))}</td>
              <td class="result-cell"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderSummary(computed) {
  return `
    <section class="sheet-block area-summary">
      <div class="sheet-title">帳戶彙總</div>
      <div class="table-wrap">
        <table class="summary-table">
          <tbody>
            ${resultRow("總淨值", money(computed.totals.netWorth))}
            ${resultRow("全部損益", money(computed.totals.totalProfit), computed.totals.totalProfit)}
            ${resultRow("全部報酬率", percent(computed.totals.totalReturn), computed.totals.totalReturn)}
            ${resultRow("今年損益", money(computed.totals.yearlyProfit), computed.totals.yearlyProfit)}
            ${resultRow("今年報酬率", percent(computed.totals.yearlyReturn), computed.totals.yearlyReturn)}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderPosition(computed) {
  const reservedCash = computed.account.reservedCash;
  const netWorth = computed.totals.netWorth;
  const total = reservedCash + netWorth;
  const cashPct = total > 0 ? reservedCash / total : 0;
  const stocksPct = total > 0 ? netWorth / total : 0;
  return `
    <section class="sheet-block area-position">
      <div class="sheet-title">部位</div>
      <div class="table-wrap">
        <table class="position-table">
          <tbody>
            <tr>
              <td class="result-cell label">現金</td>
              ${editableCell("account.reservedCash", reservedCash, "integer", "number-cell")}
              <td class="result-cell number-cell">${percent(cashPct)}</td>
            </tr>
            <tr>
              <td class="result-cell label">股票</td>
              <td class="result-cell number-cell">${money(netWorth)}</td>
              <td class="result-cell number-cell">${percent(stocksPct)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderStatus(computed) {
  return `
    <section class="sheet-block area-status">
      <div class="sheet-title">持股狀態</div>
      <div class="table-wrap">
        <table class="status-table">
          <thead>
            <tr>
              <th class="name-cell">持股</th>
              <th>總成本</th>
              <th>成本比重</th>
              <th>市值</th>
              <th>市值比重</th>
              <th>損益</th>
              <th>報酬率</th>
            </tr>
          </thead>
          <tbody>
            ${computed.holdings
              .map(
                (row) => `
                  <tr>
                    <td class="result-cell name-cell">${escapeHtml(row.symbol)}</td>
                    <td class="result-cell number-cell">${money(row.totalCost)}</td>
                    <td class="result-cell number-cell">${percent(row.costWeight)}</td>
                    <td class="result-cell number-cell">${money(row.marketValue)}</td>
                    <td class="result-cell number-cell">${percent(row.marketWeight)}</td>
                    <td class="result-cell number-cell ${tone(row.profit)}">${money(row.profit)}</td>
                    <td class="result-cell number-cell ${tone(row.returnRate)}">${percent(row.returnRate)}</td>
                  </tr>
                `,
              )
              .join("")}
            <tr>
              <td class="result-cell">現金</td>
              <td class="result-cell number-cell">${money(computed.account.cash)}</td>
              <td class="result-cell number-cell">${percent(divideOrNull(computed.account.cash, computed.totals.totalCost))}</td>
              <td class="result-cell number-cell">${money(computed.account.cash)}</td>
              <td class="result-cell number-cell">${percent(divideOrNull(computed.account.cash, computed.totals.totalMarketValue))}</td>
              <td class="result-cell"></td>
              <td class="result-cell"></td>
            </tr>
            <tr>
              <td class="result-cell">總計</td>
              <td class="result-cell number-cell">${money(computed.totals.totalCost)}</td>
              <td class="result-cell"></td>
              <td class="result-cell number-cell">${money(computed.totals.totalMarketValue)}</td>
              <td class="result-cell"></td>
              <td class="result-cell"></td>
              <td class="result-cell"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderOrders(computed) {
  return `
    <section class="sheet-block area-orders">
      <div class="action-row">
        <button class="excel-button" type="button" data-action="initialize-orders">初始化</button>
        <button class="excel-button" type="button" data-action="clear-orders">清空</button>
      </div>
      <div class="sheet-title">下單試算</div>
      <div class="table-wrap">
        <table class="order-table">
          <thead>
            <tr>
              <th class="name-cell">持股</th>
              <th>加買股數</th>
              <th>股價</th>
              <th>交割款</th>
            </tr>
          </thead>
          <tbody>
            ${computed.orderRows
              .map(
                (row, index) => `
                  <tr>
                    <td class="result-cell name-cell">${escapeHtml(row.symbol)}</td>
                    ${editableCell(`orders.${index}.quantity`, row.quantity, "number", "number-cell")}
                    ${editableCell(`orders.${index}.price`, row.price, "number", "number-cell", "0.01")}
                    <td class="result-cell number-cell ${tone(row.settlement)}">${money(row.settlement)}</td>
                  </tr>
                `,
              )
              .join("")}
            <tr class="remaining-row">
              <td class="result-cell total-label" colspan="3">剩餘現金</td>
              <td class="result-cell number-cell ${tone(computed.totals.remainingCash)}">${money(computed.totals.remainingCash)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderDataTools() {
  return `
    <details class="data-tools">
      <summary>資料匯入/匯出</summary>
      <div class="config-row">
        <label for="priceApiUrl">股價 API URL</label>
        <input id="priceApiUrl" class="config-input" type="url" value="${escapeHtml(portfolio.account.priceApiUrl || "")}" data-path="account.priceApiUrl" placeholder="https://你的-worker.workers.dev/" />
      </div>
      <textarea id="jsonBox" spellcheck="false">${escapeHtml(JSON.stringify(portfolio, null, 2))}</textarea>
      <input id="backupFileInput" class="file-input" type="file" accept="application/json,.json" />
      <div class="tools-actions">
        <button class="excel-button" type="button" data-action="backup-config">備份設定檔</button>
        <button class="excel-button" type="button" data-action="import-file">匯入設定檔</button>
        <button class="excel-button" type="button" data-action="export-json">匯出到文字框</button>
        <button class="excel-button" type="button" data-action="import-json">從文字框匯入</button>
        <button class="excel-button" type="button" data-action="reset-data">重設</button>
      </div>
    </details>
  `;
}

function renderNotice(errors) {
  if (!errors.length) return "";
  return `
    <section class="notice">
      <h2>檢查</h2>
      <ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>
    </section>
  `;
}

function editableRow(label, path, value, type, inputMode = "numeric") {
  return `
    <tr>
      <td class="label result-cell">${label}</td>
      ${editableCell(path, value, type, "number-cell", "1", inputMode)}
    </tr>
  `;
}

function editablePercentRow(label, path, value, digits) {
  return `
    <tr>
      <td class="label result-cell">${label}</td>
      ${editablePercentCell(path, value, digits)}
    </tr>
  `;
}

function resultRow(label, value, signedValue = null) {
  return `
    <tr>
      <td class="label result-cell">${label}</td>
      <td class="result-cell number-cell ${signedValue == null ? "" : tone(signedValue)}">${value}</td>
    </tr>
  `;
}

function editableCell(path, value, type = "number", className = "", step = "1", inputMode = "decimal") {
  const isNumeric = type === "number" || type === "integer";
  const inputType = isNumeric ? "text" : type;
  const inputValue = type === "integer" ? formatInteger(value) : isNumeric ? formatPlainNumber(value) : formatInput(value, type);
  return `
    <td class="editable-cell ${className}">
      <input class="cell-input" type="${inputType}" value="${escapeHtml(inputValue)}" data-path="${path}" ${
        isNumeric ? `inputmode="${inputMode}" data-number="true"` : ""
      } />
    </td>
  `;
}

function editablePercentCell(path, value, digits) {
  return `
    <td class="editable-cell number-cell">
      <input class="cell-input" type="text" value="${percentInputValue(value, digits)}" data-percent-path="${path}" inputmode="decimal" />
    </td>
  `;
}

function wireEvents() {
  app.addEventListener("input", (event) => {
    const target = event.target;
    if (target.matches("[data-path]")) {
      updatePath(target.dataset.path, target.dataset.number === "true" ? parseNumberInput(target.value) : target.value);
      savePortfolio(false);
    }
    if (target.matches("[data-percent-path]")) {
      updatePath(target.dataset.percentPath, parsePercentInput(target.value));
      savePortfolio(false);
    }
  });

  app.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches("[data-path], [data-percent-path]")) {
      portfolio = normalizePortfolio(portfolio);
      savePortfolio(false);
      render();
    }
  });

  app.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.matches("[data-path], [data-percent-path]")) {
      event.preventDefault();
      event.target.blur();
    }
  });

  app.addEventListener("click", (event) => {
    const control = event.target.closest("[data-action]");
    const action = control?.dataset.action;
    if (!action) return;
    handleAction(action, control);
  });

  app.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches("#backupFileInput")) {
      importBackupFile(target.files?.[0]);
      target.value = "";
    }
  });
}

function handleAction(action, control) {
  if (action === "update-prices") {
    updatePricesFromApi(control);
    return;
  }
  if (action === "sort-holdings") {
    portfolio = sortHoldingsByCode(portfolio);
    savePortfolio(true, "已依代號排序");
    render();
    return;
  }
  if (action === "clear-holding") {
    const index = Number(control?.dataset.index);
    if (!Number.isInteger(index)) return;
    const name = portfolio.holdings[index]?.symbol || `第 ${index + 1} 列`;
    if (!window.confirm(`確定要清除「${name}」的持股資料？預計比重和下單資料會保留。`)) return;
    portfolio = clearHoldingRow(portfolio, index);
    savePortfolio(true, "已清除持股資料");
    render();
    return;
  }
  if (action === "initialize-orders") {
    portfolio = initializeOrders(portfolio);
    savePortfolio(true, "已初始化");
    render();
    return;
  }
  if (action === "auto-orders") {
    portfolio = autoCalculateOrders(portfolio);
    savePortfolio(true, "已自動計算");
    render();
    return;
  }
  if (action === "clear-orders") {
    portfolio = clearOrders(portfolio);
    savePortfolio(true, "已清空");
    render();
    return;
  }
  if (action === "export-json") {
    const box = document.querySelector("#jsonBox");
    box.value = JSON.stringify(portfolio, null, 2);
    box.select();
    toast("已匯出到文字框");
    return;
  }
  if (action === "backup-config") {
    downloadPortfolioBackup();
    toast("已建立備份檔");
    return;
  }
  if (action === "import-file") {
    document.querySelector("#backupFileInput")?.click();
    return;
  }
  if (action === "import-json") {
    const box = document.querySelector("#jsonBox");
    try {
      portfolio = normalizePortfolio(JSON.parse(box.value));
      savePortfolio(true, "已匯入");
      render();
    } catch {
      toast("JSON 格式錯誤");
    }
    return;
  }
  if (action === "reset-data") {
    if (!window.confirm("確定要重設為預設資料？目前瀏覽器裡的資料會被覆蓋。")) return;
    portfolio = createDefaultPortfolio();
    savePortfolio(true, "已重設");
    render();
  }
}

async function importBackupFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    portfolio = normalizePortfolio(JSON.parse(text));
    savePortfolio(true, "已匯入設定檔");
    render();
  } catch {
    toast("設定檔格式錯誤");
  }
}

async function updatePricesFromApi(control) {
  const apiUrl = String(portfolio.account.priceApiUrl || "").trim();
  if (!apiUrl) {
    document.querySelector(".data-tools")?.setAttribute("open", "");
    toast("請先設定股價 API URL");
    return;
  }

  const symbols = portfolio.holdings
    .map((row) => stockCodeForSort(row.symbol))
    .filter(Boolean);

  if (!symbols.length) {
    toast("沒有可更新的股票代號");
    return;
  }

  const originalText = control?.textContent;
  if (control) {
    control.disabled = true;
    control.textContent = "更新中";
  }

  try {
    const endpoint = new URL(apiUrl);
    endpoint.searchParams.set("symbols", symbols.join(","));
    const response = await fetch(endpoint.toString(), { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }

    const prices = payload.prices || {};
    let updatedCount = 0;
    portfolio = normalizePortfolio({
      ...portfolio,
      holdings: portfolio.holdings.map((row) => {
        const code = stockCodeForSort(row.symbol);
        const price = priceFromMap(prices, code);
        if (price == null) return row;
        updatedCount += 1;
        return { ...row, price };
      }),
    });

    savePortfolio(false);
    render();
    toast(updatedCount ? `已更新 ${updatedCount} 檔股價` : "沒有抓到可更新的股價");
  } catch (error) {
    toast(`股價更新失敗: ${error.message}`);
  } finally {
    if (control?.isConnected) {
      control.disabled = false;
      control.textContent = originalText;
    }
  }
}

function priceFromMap(prices, code) {
  const key = String(code || "");
  const value = prices[key] ?? prices[key.toUpperCase()] ?? prices[key.toLowerCase()];
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function downloadPortfolioBackup() {
  const backup = {
    _meta: {
      app: "持股管理",
      version: 1,
      exportedAt: new Date().toISOString(),
    },
    ...portfolio,
  };
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `stock-manager-backup-${timestampForFile()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timestampForFile() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

function updatePath(path, value) {
  const parts = path.split(".");
  let cursor = portfolio;
  while (parts.length > 1) {
    cursor = cursor[parts.shift()];
  }
  cursor[parts[0]] = Number.isNaN(value) ? 0 : value;
  portfolio = normalizePortfolio(portfolio);
}

function clearHoldingRow(data, index) {
  const next = normalizePortfolio(data);
  next.holdings[index] = createEmptyHolding(next.holdings[index]?.targetWeight);
  return normalizePortfolio(next);
}

function sortHoldingsByCode(data) {
  const next = normalizePortfolio(data);
  const rows = next.holdings.map((holding, index) => ({
    holding,
    order: next.orders[index] || createEmptyOrder(),
    originalIndex: index,
  }));

  rows.sort((a, b) => compareHoldingRows(a, b));

  return normalizePortfolio({
    ...next,
    holdings: rows.map((row) => row.holding),
    orders: rows.map((row) => row.order),
  });
}

function compareHoldingRows(a, b) {
  const aEmpty = !a.holding.symbol.trim();
  const bEmpty = !b.holding.symbol.trim();
  if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
  if (aEmpty && bEmpty) return a.originalIndex - b.originalIndex;

  const aCode = stockCodeForSort(a.holding.symbol);
  const bCode = stockCodeForSort(b.holding.symbol);
  const compared = new Intl.Collator("zh-Hant", { numeric: true, sensitivity: "base" }).compare(aCode, bCode);
  return compared || a.originalIndex - b.originalIndex;
}

function stockCodeForSort(symbol) {
  const text = String(symbol || "");
  return text.match(/[（(]([A-Za-z0-9.]+)[）)]/)?.[1] || text.match(/[A-Za-z0-9.]+/)?.[0] || text;
}

function createEmptyHolding(targetWeight = 0) {
  return {
    symbol: "",
    shares: 0,
    cost: 0,
    cashDividend: 0,
    stockDividend: 0,
    price: 0,
    targetWeight,
  };
}

function createEmptyOrder() {
  return {
    quantity: 0,
    price: 0,
  };
}

function loadPortfolio() {
  try {
    const stored = localStorage.getItem(STORE_KEY);
    const loaded = stored ? normalizePortfolio(JSON.parse(stored)) : createDefaultPortfolio();
    return isBlankPortfolio(loaded) ? createDefaultPortfolio() : loaded;
  } catch {
    return createDefaultPortfolio();
  }
}

function isBlankPortfolio(data) {
  const hasAccountValue = Boolean(data.account.name || data.account.code || data.account.initialCapital || data.account.yearlyCapital || data.account.cash);
  const hasHoldingValue = data.holdings.some((row) => row.symbol || row.shares || row.cost || row.price);
  const hasOrderValue = data.orders.some((row) => row.quantity || row.price);
  return !hasAccountValue && !hasHoldingValue && !hasOrderValue;
}

function savePortfolio(showToast = false, message = "已儲存") {
  localStorage.setItem(STORE_KEY, JSON.stringify(portfolio));
  if (showToast) toast(message);
}

function money(value) {
  if (value == null || Number.isNaN(Number(value))) return "";
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(value);
}

function number(value) {
  if (value == null || value === "") return "";
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(value);
}

function percent(value) {
  if (value == null || Number.isNaN(Number(value))) return "";
  return new Intl.NumberFormat("zh-TW", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatInput(value, type) {
  if (type === "text") return value == null ? "" : String(value);
  if (value == null || Number.isNaN(Number(value))) return "";
  return String(value);
}

function formatPlainNumber(value) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "";
  return String(value);
}

function formatInteger(value) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "";
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(value);
}

function parseNumberInput(value) {
  const numeric = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function tone(value) {
  if (value == null) return "";
  return Number(value) < 0 ? "negative" : Number(value) > 0 ? "positive" : "";
}

function divideOrNull(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function numberFromInput(input) {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : 0;
}

function parsePercentInput(value) {
  const raw = String(value ?? "").trim().replace(/,/g, "");
  if (!raw) return 0;
  const hasPercent = raw.includes("%");
  const numeric = Number(raw.replace(/%/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  if (hasPercent) return numeric / 100;
  return Math.abs(numeric) > 1 ? numeric / 100 : numeric;
}

function percentInputValue(value, digits) {
  return `${round((value || 0) * 100, digits).toFixed(digits)}%`;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  Object.assign(node.style, {
    position: "fixed",
    right: "12px",
    bottom: "12px",
    zIndex: "20",
    background: "#111",
    color: "#fff",
    padding: "8px 10px",
    borderRadius: "4px",
  });
  document.body.append(node);
  window.setTimeout(() => node.remove(), 1500);
}
