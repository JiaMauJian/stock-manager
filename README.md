# 持股管理 (stock-manager)

一個純前端的持股試算表：輸入持股、成本、目標權重，自動算出市值、損益、再平衡的買賣張數。
沒有後端、沒有建置流程，開啟 `index.html` 就能跑。

---

## 檔案結構

| 檔案 | 用途 |
| --- | --- |
| `index.html` | 唯一的頁面，掛載 `#app` 容器 |
| `app.js` | 畫面渲染、事件處理、localStorage 存取、股價更新、匯入匯出 |
| `portfolio-engine.js` | 純計算邏輯：normalize、市值/損益/權重、再平衡下單 |
| `styles.css` | 版面樣式（模仿 Excel 試算表外觀） |
| `worker/` | Cloudflare Worker：股價查詢 + 跨裝置同步（KV） |

`app.js` 用 `<script type="module">` 載入，所以**不能用 `file://` 直接開**（ES module 會被 CORS 擋掉）。
本機開發請起一個靜態伺服器：

```bash
npx serve .
# 或
python -m http.server 8000
```

---

## 資料儲存

所有資料存在瀏覽器的 `localStorage`，key 為 `holdings-mobile-portfolio-v1`（見 `app.js`）。

**這代表資料預設是綁在「這台裝置的這個瀏覽器」上的** —— 換裝置、換瀏覽器、清除瀏覽資料都會不見。
要跨裝置請看下方的「跨裝置同步」。

### 資料結構

```jsonc
{
  "account": {
    "name": "",            // 帳號姓名
    "code": "",            // 帳號代碼
    "feeRate": 0,          // 手續費率
    "initialCapital": 0,   // 原始資金
    "yearlyCapital": 0,    // 今年股本
    "cash": 0,             // 現金餘額
    "reservedCash": 0,     // 保留現金（動能系統用）
    "priceApiUrl": ""      // Worker 網址（股價＋同步共用），見下一節
  },
  "holdings": [
    {
      "symbol": "台積電(2330)",
      "shares": 0,
      "cost": 0,
      "cashDividend": 0,
      "stockDividend": 0,
      "price": 0,
      "targetWeight": 0
    }
  ],
  "orders": [{ "quantity": 0, "price": 0 }]
}
```

### 備份與還原

展開頁面底部的「設定與同步」：最上面是 Worker 網址，接著是**跨裝置同步**與**備份與重設**兩段。

「備份與重設」裡：

- **備份設定檔** — 下載 `stock-manager-backup-YYYYMMDD-HHMMSS.json`
- **匯入設定檔** — 從剛才那個 json 檔還原
- **重設** — 清空回預設值

雲端同步只保留最新一份、上傳即覆蓋，所以它不等於備份 —— 動大手術前還是先存一份備份檔。

要手動改資料的話，備份出來的 json 檔就是完整格式，用文字編輯器改完再「匯入設定檔」寫回。

---

## 股價自動更新

「持股資料」區塊的「更新」按鈕會呼叫一支 Cloudflare Worker 抓即時股價。

### 設定方式

展開「設定與同步」，在最上面的 **Worker 網址** 欄位填入，例如：

```
https://rapid-art-d7f8.amau712.workers.dev/
```

填好會跟著 portfolio 一起存進 localStorage，之後就不用再填。

### Worker API 規格

**Request**

```
GET {priceApiUrl}?symbols=2330,0050,AAPL
```

`symbols` 由 `app.js` 從每筆持股的 `symbol` 欄位抽出股票代號後用逗號串起來。
抽取規則：優先取括號內的代號（`台積電(2330)` → `2330`），沒有括號就取第一段英數字。

**Response**

```json
{
  "ok": true,
  "source": "yahoo",
  "updatedAt": "2026-08-10T01:40:22.548Z",
  "prices": { "2330": 2400, "2330.TW": 2400, "0050": 104.4 },
  "missing": []
}
```

- `prices` 的 key 可以同時給裸代號和帶後綴的（`2330` / `2330.TW`），前端兩種都會試著比對，也會忽略大小寫
- 只有 `> 0` 的有限數字會被採用，其餘該筆持股的價格保持原值
- 失敗時回 `{"ok": false, "error": "..."}`，前端會把 `error` 顯示在 toast

**CORS**

Worker 必須回 `Access-Control-Allow-Origin`（目前設為 `*`），否則瀏覽器會擋掉請求。

---

## 部署

兩個獨立的 Cloudflare 部署：

| | 網址 | 內容 |
| --- | --- | --- |
| 前端 | `https://stock-manager.amau712.workers.dev` | 靜態檔案（Workers static assets） |
| 後端 | `https://rapid-art-d7f8.amau712.workers.dev` | 股價 + 同步 API |

### 前端

已經接上這個 GitHub repo，**push 到 `main` 就會自動重新部署**，不用手動做任何事。

```bash
git push
```

手機、平板開同一個網址就能用，但資料要靠同步碼才會互通（見「跨裝置同步」）。

### 後端

見下方「Worker 部署」。

---

## 跨裝置同步

用 Worker + KV 做手動同步：電腦改完按「上傳到雲端」，手機打開按「從雲端下載」。

### 同步碼

同步是靠一組**同步碼**分帳的，沒有註冊、沒有登入：

1. 任一台裝置在「設定與同步 → 跨裝置同步」按 **產生新同步碼**（24 碼隨機字元）
2. 把這組碼抄到其餘裝置的「同步碼」欄位
3. 這些裝置就共用雲端上的同一份資料

同步碼只存在該台裝置的 localStorage，**不會**跟著備份檔或雲端資料跑。換新裝置還原備份後，Worker 網址會自己回來（它存在 portfolio 裡），但同步碼要自己重新填。
> **知道同步碼的人就能讀寫那份資料。** 這是刻意換來的簡單性——不要把同步碼貼在公開的地方，也不要放進網址列（會留在瀏覽紀錄）。
> 分享給別人時，請他自己按「產生新同步碼」，各自一組互不干擾。

### 防覆蓋

同步碼、上次同步時間存在 localStorage 的 `holdings-mobile-sync-v1`（和 portfolio 分開存，所以不會被上傳）。

- **上傳前**會先讀雲端，如果雲端版本比你上次同步過的還新（代表別台裝置傳過東西），會跳確認視窗
- **下載前**如果偵測到本機有尚未上傳的變更，也會跳確認視窗
- 同步碼欄位下方會顯示上次同步時間與「本機有尚未上傳的變更」提示

沒有自動合併——衝突時由你決定要哪一邊。以這個 app 的使用情境（一個人、幾台裝置）這樣就夠了。

### Sync API 規格

```
GET /portfolio?key=<同步碼>
→ 200 {"ok":true,"portfolio":{...},"updatedAt":"...","device":"Windows"}
→ 404 {"ok":false,"error":"雲端還沒有這組同步碼的資料"}

PUT /portfolio?key=<同步碼>
   body: {"portfolio":{...},"device":"Windows"}
→ 200 {"ok":true,"updatedAt":"..."}
```

同步碼須符合 `^[A-Za-z0-9_-]{16,128}$`，request body 上限 64 KB。

### 額度

KV 免費方案的瓶頸是**每日寫入次數**（讀取額度寬鬆得多）。因為上傳是手動觸發的，10 人以內的使用量離上限還很遠。若之後人數變多、或想改成自動同步，再換成 D1 會比較合適。實際額度請以 Cloudflare 官方文件為準。

---

## Worker 部署

`worker/` 底下是完整的 Worker 原始碼，股價和同步兩組路由都在裡面。

```bash
cd worker

# 1. 建立 KV namespace，把印出來的 id 填進 wrangler.toml
npx wrangler kv namespace create PORTFOLIO

# 2. 部署
npx wrangler deploy
```

> 如果你想保留原本那支 Worker 的股價實作，不要整包覆蓋——把 `src/index.js` 裡「同步（KV）」那一段搬過去，並在 `fetch` 進入點加上 `/portfolio` 的分流就好。

### CORS 設定

`ALLOWED_ORIGIN` 決定哪些網站能呼叫這支 Worker。預設 `*` 代表任何網站都可以，等於把股價 API 免費開放出去；建議鎖成前端網域：

```toml
[vars]
ALLOWED_ORIGIN = "https://stock-manager.amau712.workers.dev"
```

用 Dashboard 的話：Worker → **Settings** → **Bindings**（或 Variables and Secrets）→ 編輯 `ALLOWED_ORIGIN`，改完即時生效，不用重貼程式碼。

**格式必須是 `scheme://host`，結尾不能有斜線、不能帶路徑。** 瀏覽器送出的 `Origin` 標頭就是這個格式，多一個字元就比對不到，所有請求都會被 CORS 擋掉。

目前只支援單一網域。如果之後要同時允許多個來源（自訂網域、preview 部署），需要把 `corsHeaders()` 改成比對逗號分隔的清單、並回傳當次請求的 `Origin`。

---

## 已知限制

- 沒有測試（`tests/` 已在 `.gitignore` 中排除）
- 沒有多帳戶支援，一個瀏覽器只能存一份 portfolio
- 持股上限 5 檔（`portfolio-engine.js` 的 `MAX_HOLDINGS`）
- 同步碼即密碼，沒有真正的身分驗證
- 股價來源為 Yahoo，非官方 API，可能隨時失效
