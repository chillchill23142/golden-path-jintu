# 騎練勝率結算規格

狀態：草稿規格，文件為先。本文沒有實作，沒有量度結果，也不是上線核準，不批准讀取 localresults，也不改 `api/officialResults.js`，並不把現行預設係數當成已校準，也不打開 `GP_PACK_S` 或 `GP_FEATURE_CONDITIONS`。單憑現時已批准的 resultsall，不能計騎練配對勝率。

本文以香港繁體中文撰寫。對照基線是目前 `main` 的 `6db43ad5473b75f3975193799d15398bef7c1c9a`（PR #10 已合併）。本文是文件為先的草稿規格，不是實作核准，也不是上線核准。合併本文不改變今日的 `type=predict` 路徑。旗標保持預設關閉。本文不改係數。

相關規格：[Size S：盤口基線 + 已有特徵調整](pack-s-features-spec.md)、[特徵先行條件](feature-conditions-spec.md)。那兩份已經寫明：騎師與練馬師只組成配對鍵，不計算勝率，也不調整概率。本文不改寫那些段落，也不改它們的旗標用語。

## 1. 已核對的結論

單憑現時已批准的 resultsall，不能計騎練配對勝率。現行預設係數不是已校準。

`api/featureConditions.js` 的 `FEATURE_CONDITION_DEFAULTS` 與 `api/packS.js` 的 `PACK_S_DEFAULTS` 仍是未經量度的實作預設，不是校準。配對的係數是 0。這條鍵不計出賽次數、勝出次數或勝率，也不調整概率。

本文不寫時間窗、最低樣本數或收縮的數字。日後若另案算出歷史勝率，該數字不是校準，不得寫進現行預設係數，也不得用來打開 `GP_PACK_S` 或 `GP_FEATURE_CONDITIONS`。

## 2. 配對只用代碼鍵

配對只可用代碼鍵。在 `api/packS.js` 與 `api/featureConditions.js`，`jockeyTrainerPair` 只用 `runner.jockey.code` 與 `runner.trainer.code`，組成有序對：騎師代碼在前，練馬師代碼在後。

- 字串形式是 `騎師代碼|練馬師代碼`。
- 只去掉首尾空白。去掉之後，任一代碼含半形豎線 `|`，字串形式留空；有序對仍在。
- 不去大小寫，不全形半形轉換。
- 不以姓名回退。不用 `name_ch`、`name_en`、`jockey_ch`、`trainer_ch`。
- 不讀 `trainerPreference`。
- 去掉首尾空白後，任一邊不是非空字串：該馬沒有配對鍵。

現行配對係數是 0。這條鍵不計出賽、勝出或勝率，也不調整概率。

## 3. 現時唯一已批准的結算來源

現時唯一已批准的結算來源是 `type=official-results`。它讀公開的 resultsall 頁，例如 [沙田 2026-11-22 的 resultsall](https://racing.hkjc.com/zh-hk/local/information/resultsall?Racecourse=ST&racedate=2026/11/22)。

`api/officialResults.js` 抽出名次、馬號、馬名、`jockey_ch`、`trainer_ch`、實際負磅、檔位，以及派彩（包括「位置」彩池）。它不抽出 `jockeyid`、`trainerid`、`horseid`。倉庫樣本是 `test/fixtures/official-results-2026-11-22-st.html`。本文不改這個解析器。

香港時間 2026-11-28 約 02:54–02:58 的頁面覆核如下。沙田 2026-11-22 的 resultsall 約於 02:54:13 取得。11 場之中，每場賽果表只見名次 1 至 4，沒有 `jockeyid`、`trainerid`、`horseid`。第 1 場「位置」派彩的馬號是 6、12、2，對應該場第一至第三名。

因此，resultsall 只給出姓名、名次、馬號、實際負磅、檔位與派彩，而且賽果表只見頭 4 名，造不出配對鍵。若把這可見的頭 4 行當成出賽全體，勝率會被抬高。位置派彩只可標示名次，不能填出賽分母，也不能填配對鍵。

## 4. localresults 只是候選，不在現行範圍

與 resultsall 同站的 localresults 是候選來源，不在現時已批准的範圍。倉庫沒有這條頁的網址，本文不另造網址。以下只記述該頁與當次覆核。

香港時間 2026-11-28 約 02:55:28，以 GET 讀沙田 2026-11-22 第 1 場。回應是 HTTP 200。該頁有完整名次 1 至 14，同一列有代碼，並有「獨贏 賠率」與「沿途走位」。頁內亦有 `Racecourse=S1` 的連結。

本文不批准讀取 localresults，也不改 `api/officialResults.js`。該頁顯示的獨贏賠率不得用作分析條件，也不得用作基線。沿途走位不是跑法。頁上識別碼是否與 GraphQL 代碼同一套系統，這次偵察沒有核實。

若日後另案批准讀取該頁，身份必須對上所請求的日期、馬場與場次。對不上就失敗關閉。該頁亦含 `Racecourse=S1` 的連結，不得把另一場馬場當成所請求的一場。

## 5. 結算標籤

勝出與位置的結算標籤，只可來自已刊出的官方賽果 HTML，而且只用於歷史或已完成的賽事。名次優先使用已經批准的 resultsall「位置」派彩欄。

一場賽事的結算不得倒灌進該場的賽前條件。本文不寫時間窗、最低樣本數或收縮的數字。日後另計的任何歷史勝率都不是校準，不得寫進現行預設係數，也不得用來打開 `GP_PACK_S` 或 `GP_FEATURE_CONDITIONS`。

## 6. 另一條只作紀錄的路徑

若日後仍不批准讀取 localresults，下面這條路徑只作紀錄。它不是實作核准，也不是上線核准。

會議仍可從已批准的查詢讀到時，按馬號留下當時的代碼。resultsall 刊出之後，以日期、馬場、場次與馬號對上。沒有留下代碼的舊賽不能回填。馬名對不上的那一次，沒有配對鍵。

這條路徑不改查詢文字，不改 allowlist，也不改 `api/officialResults.js`。

## 7. 隔離

本文沒有實作，沒有量度結果，也不是上線核准。旗標保持預設關閉。本倉庫沒有把 `GP_PACK_S` 或 `GP_FEATURE_CONDITIONS` 寫成啟用。合併本文不改變今日的 `type=predict` 路徑，也不把現行預設係數當成已校準。

本文不改模型、API、測試、`index.html`、allowlist、查詢文字、憑證、環境、網域或 SSO，也不打開任一旗標。單憑現時已批准的 resultsall，不能計騎練配對勝率。
