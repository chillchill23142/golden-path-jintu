# Size S 規格：盤口基線 + 已有特徵調整

狀態：已有實作，旗標預設關閉。`GP_PACK_S` 已由程式讀取。沒有量度結果，也不是上線核准，亦不批准把旗標打開。旗標關閉時，預測仍只用當前會議的獨贏賠率基線，與今日 `predictFromNodes` 逐位相同。

獨立於本文：[特徵先行條件](feature-conditions-spec.md)。該規格的分析條件不是賠率，也不把本文未經量度的係數視為已校準。其旗標預設關閉；開啟時 `type=predict` 不使用本文的獨贏基線，也不採用本文的係數。

本文以香港繁體中文撰寫。對照的程式以目前 `main` 的 `442e2e14e2b299471eedc17bdc1014c87f89eebc` 為準（Size S 實作已於 PR #6 合併；預測頁按模型切換文案已於 PR #9 合併）。本文不改模型、API、allowlist、查詢文字、憑證、環境、網域或 SSO，也不把旗標寫成啟用。

## 1. 目的與 Size S 定義

Size S 的定義是：保留今日的獨贏賠率作為盤口基線，並可在這條基線之上，用已經可以取得的特徵作有界調整。這些調整的係數是未經量度的實作預設，不是校準，也不是把旗標打開的核准。旗標關閉時不套用調整。

調整只可使用第 3 節列出的欄位。這些欄位今日已經出現在允許的 GraphQL 文件、官方賽果 HTML，或介面之中。Size S 不新增資料來源。

旗標名稱是 `GP_PACK_S`。`api/packS.js` 的 `isPackSEnabled` 已經讀取它。

- 預設關閉。只有環境值精確等於字串 `1` 才算開啟。
- `GP_PACK_S` 未設定、空字串、`0`，以及任何其他不是該精確字串的值，而且 `GP_FEATURE_CONDITIONS` 也不是精確字串 `1` 時，維持第 2 節的只按賠率行為，與 `predictFromNodes` 逐位相同。
- 本倉庫沒有環境檔，也沒有把 `GP_PACK_S` 寫成啟用。打開旗標不是本文件的核准。
- 係數在 `api/packS.js` 的 `PACK_S_DEFAULTS`。它們是未經量度的實作預設，不是校準，也不是上線核准。
- `GP_FEATURE_CONDITIONS` 精確等於字串 `1` 時，不使用這條獨贏基線，也不使用這些係數。

本規格不是上線核准。即使本文被合併，Size S 仍未可以投入生產。

## 2. 現況：只按賠率（本文不改這段行為）

以下是旗標關閉時的路徑。`GP_PACK_S` 不是精確字串 `1`，而且 `GP_FEATURE_CONDITIONS` 也不是精確字串 `1` 時，`api/races.js` 在 `type=predict` 只呼叫 `WIN_POOL_QUERY`，取出該場獨贏彩池的 `oddsNodes`，再交給 `predictFromNodes`。回應與今日這條路徑逐位相同，`model` 是 `Odds-based probability model`。

每條賠率節點今日這樣計算：

- 賠率取 `parseFloat(oddsValue)`。無法解析，或結果為 `0` 時，程式用 `99`。
- 未截斷的概率是 `100 / 賠率 × 1.2`。乘除由左至右，即先除以賠率，再乘 `1.2`。
- 概率截在 `5` 至 `95`。
- `winProb` 是上述結果四捨五入到小數點後一位。
- `horse` 直接使用 `combString`。
- `confidence`：賠率小於 `4` 為「高」，小於 `8` 為「中」，其餘為「低」。因此 `4` 屬「中」，`8` 屬「低」。
- 按 `winProb` 由高至低排序，只保留前 5 筆。不足 5 筆則全部保留。

這條旗標關閉的路徑不讀取排位、檔位、負磅、體重、配備、騎師或練馬師。`type=meetings` 與 `type=races` 才讀 `RACE_MEETINGS_QUERY`。預測介面會用已經載入的當前會議排位，把馬號對上馬名；這只影響顯示，不進入 `predictFromNodes`。

預測頁的旗標關閉文案是：「預測只根據當前會議的獨贏賠率，不能按日期或馬場查詢其他賽事。沒有使用晨操、試閘、傷患或其他特徵條件。」`GP_PACK_S` 關閉時這句正確。只開啟 Size S 時，`model` 是 `Odds baseline plus unmeasured Size S adjustments`，頁面仍用這句旗標關閉文案，不會改成特徵條件文案。本文不改 `index.html`。

盤口基線固定使用獨贏彩池 `oddsNodes.oddsValue`。排位上的 `runner.winOdds`、以及節點上的 `hotFavourite`、`oddsDropValue`，都不是基線，也不屬於 Size S。

## 3. 特徵清單

下表只收今次範圍以內、而且來源已經存在的欄位。第 5 節的欄位即使查詢已經回傳，亦未獲批准使用。

「今日有否進入預測」一欄指旗標關閉時的預設路徑：這些欄位不進入 `predictFromNodes`。`GP_PACK_S` 精確等於字串 `1`，而且 `GP_FEATURE_CONDITIONS` 不是精確字串 `1` 時，檔位、已宣告負磅與體重才以未經量度的預設，在獨贏基線上作有界調整。跑道、途程、場地與配備的係數是 0，不另建勝率表。騎師與練馬師只組成配對鍵，不計算勝率，也不調整概率。這些係數不是校準，也不是上線核准。

共通缺值規則：

- 該特徵不產生調整。馬匹仍保留盤口基線，不因缺值被剔除。
- 不填補。不用同場中位數，不用歷史平均，也不用 `0` 冒充「已知為零」，除非下面某一列另有說明。
- 不把另一個欄位抄來頂替。
- 已結束賽事的官方賽果，不得填進當前會議的缺值。當前會議的欄位，亦不得填進已結束賽事。

旗標開啟且特徵條件旗標關閉時，排位特徵對上某一條賠率的對應是馬號：`runner.no` 對 `oddsNodes.combString`。不是馬名。

| 特徵 | 已有欄位 | 今日出現在哪裏 | 今日有否進入預測 | Size S 可如何使用 | 缺值 |
| --- | --- | --- | --- | --- | --- |
| 跑道／馬場描述 | `raceTrack.description_ch`、`raceTrack.description_en`；`raceCourse.description_ch`、`raceCourse.description_en`、`raceCourse.displayCode` | 只在 `RACE_MEETINGS_QUERY` 的 `raceFragment`。介面沒有顯示這兩個物件。介面顯示的沙田／跑馬地來自會議的 `venueCode`，不是 `raceTrack`。 | 否 | 只可作該場的跑道與馬場描述，用來理解同場其他調整。不另立一條取代賠率的跑道模型。 | 跑道兩邊描述都空，而且馬場描述與 `displayCode` 都空：不調整。`venueCode` 不得冒充跑道配置。 |
| 途程 | `distance` | 同一段 `raceFragment`。總覽、單場分析與當前排位顯示為「米」。官方賽果只在 `detail` 的其中一段符合「數字米」時拆出 `distance`，並在官方賽果頁以 `detail` 原文一併顯示。 | 否 | 只可作該場途程的上下文。市場對途程的看法已經在賠率內，途程不得取代盤口基線。 | 當前會議的 `distance` 缺或不是正數：不調整。官方賽果拆不出「數字米」時，不把整段 `detail` 當成結構化途程。 |
| 場地狀況 | `go_ch`、`go_en` | 同一段 `raceFragment`。介面沒有顯示。官方賽果的場地字樣（第 6 節樣本 `detail` 中的「草地」）只躺在未拆開的 `detail` 內，解析器沒有獨立的場地欄。 | 否 | 只可使用當前會議已經回傳的 `go_ch`／`go_en` 文字，作為該場場地狀況。本文不建立場地對概率的對照表。 | 兩個文字都空：不調整。不得用官方賽果 `detail` 裏的字填當前會議的 `go_ch` 或 `go_en`。 |
| 檔位 | `barrierDrawNumber` | 同一查詢的出賽馬。單場分析（「賠率及檔位」）、當前排位、馬匹詳情都顯示為「檔位」。官方賽果另有「檔位」欄，解析為 `runner.barrier`，只在官方賽果頁顯示。 | 否 | 旗標開啟時可作為該馬在該場的檔位，在獨贏基線上作有界調整。係數是未經量度的實作預設。本文不把這項寫成內檔或外檔的偏差表。同場的 `wageringFieldSize` 已在 `raceFragment`，但不是一項獨立特徵，本文亦不規定用它換算檔位。 | `barrierDrawNumber` 缺、空白或不是正整數：不調整。不得用出賽數目估計一個檔，也不得用官方賽果的 `barrier` 填當前會議。 |
| 負磅 | `handicapWeight` | 同一查詢的出賽馬。單場分析、當前排位、馬匹詳情顯示為「負磅」。官方賽果的欄位是「實際負磅」，解析為 `actualWeight`，標籤是「實際負磅」。兩者不是同一欄。 | 否 | 旗標開啟時可使用當前會議已宣告的負磅，在獨贏基線上作有界調整。係數是未經量度的實作預設。本文不把磅數換算寫成已核准的長度或概率。 | 負磅缺值：不作出負磅調整。不得抄體重，不得抄官方賽果的實際負磅。 |
| 體重 | `currentWeight` | 同一查詢的出賽馬。只在馬匹詳情顯示為「體重」。第 6 節官方賽果樣本的名次表沒有體重欄，解析器也不讀體重。 | 否 | 旗標開啟時可使用當前會議已回傳的馬匹體重，在獨贏基線上作有界調整，與負磅分開。係數是未經量度的實作預設。 | 體重缺值：不作出體重調整。不得抄負磅或實際負磅。負磅仍在時，負磅這項仍可單獨調整；該調整是未經量度的預設。 |
| 配備 | `gearInfo` | 同一查詢的出賽馬。只在馬匹詳情以原字串顯示為「配備」。第 6 節官方賽果樣本的名次表沒有配備欄。 | 否 | 可把非空的配備字串當作類別代號。本文不解釋代號含義，不為任何代號配勝率。 | 欄位缺失或不是字串：不調整。空字串表示沒有可讀的配備代號，不調整，也不改寫成某個代號。 |
| 騎練合拍 | `jockey.code`、`trainer.code` | 代碼只在當前會議查詢。介面的 `personName` 只用 `name_ch`，沒有才用 `name_en`，不顯示代碼。官方賽果只有 `jockey_ch` 與 `trainer_ch` 姓名，沒有代碼。 | 否 | 今次只定義第 4 節的配對鍵。不計算勝率，不建結算。 | 任一代碼不可用：該馬沒有配對鍵。不得改用姓名。 |

`runner.horse.code` 已在同一查詢，但它不是騎練配對鍵的一部分。

## 4. 騎練合拍：只定義配對鍵

配對的雙方是該匹出賽馬當前會議已經回傳的騎師與練馬師。優先使用官方代碼，不使用姓名。

- 騎師代碼是 `runner.jockey.code`。
- 練馬師代碼是 `runner.trainer.code`。
- 邏輯鍵是有序對：騎師代碼在前，練馬師代碼在後。
- 代碼先只去掉兩端空白。不去大小寫，不全形半形轉換，不以姓名反查代碼，也不讀 `trainerPreference`。
- 去掉兩端空白後，兩邊都必須是非空字串。否則該馬沒有配對鍵。
- 字串形式已經落地：兩個代碼都不含半形豎線 `|` 時，字串為 `騎師代碼|練馬師代碼`。任一代碼含 `|` 時，字串留空；邏輯鍵仍是上面的有序對。配對鍵不計算勝率，也不調整概率。
- `name_ch`、`name_en`、`jockey_ch`、`trainer_ch` 只可顯示。代碼缺失時不得用它們補鍵。官方賽果沒有代碼，因此不能從已結束賽事的姓名造出這條鍵。

今次到此為止。不定義出賽次數、勝出次數、勝率、穩健樣本、時間窗、結算來源，或任何配對強弱分數。真正的騎練勝率須有結算管道，列在第 5 節，須另案批准。

## 5. 不在範圍，須另案批准

下列項目今次不設計實作，也不可以借 Size S 的名義加進模型。

須新資料來源，本文不引入：

- 晨操
- 試閘
- 傷患
- 跑法

須結算管道，本文不計算：

- 騎師勝率、練馬師勝率，以及騎練配對的實際勝率或其他戰績統計

查詢已經回傳、但今次不批准使用的鄰近欄位：

- `penetrometerReadings`、`hammerReadings`
- `currentRating`、`internationalRating`、`last6run`、`allowance`、`trainerPreference`
- `runner.winOdds`
- `oddsNodes.hotFavourite`、`oddsNodes.oddsDropValue`、`bankerOdds`
- `changeHistories` 內的負磅、騎師姓名與其他變更紀錄

`last6run` 是馬匹詳情已顯示的「近績」，不是跑法。顯示不等於可以進入預測。

同樣未獲本文批准的事項：改寫查詢文字、改 allowlist、改憑證、改環境、改網域、改 SSO，以及把 `GP_PACK_S` 或 `GP_FEATURE_CONDITIONS` 寫成啟用。兩個旗標都不是精確字串 `1` 時，已合併的程式維持只按賠率的路徑。本文件不指示打開任一旗標。

## 6. 資料來源與 allowlist 限制

來源邊界維持現狀。

當前會議只可使用 allowlist GraphQL，文件在 `api/officialQueries.js`。兩段匯出字串被 `test/races.test.mjs` 以 SHA-256 整段鎖定，空白也算在內：

| 常數 | operationName | 長度 | SHA-256 |
| --- | --- | --- | --- |
| `RACE_MEETINGS_QUERY` | `raceMeetings` | 4497 | `bbef8d3eb03bf9c59581e76140e8d3a7fed873b7e84a1a323b02b72f5ba736cb` |
| `WIN_POOL_QUERY` | `sp4e_racing_pmPool` | 1005 | `c08a99ca7cb4f6115db4f23028c1e0fa9e19b2fed9afdf4c404e9c0fd40b2190` |

這兩段字串不得人手改寫、重排、重新命名欄位，或為了 Size S 重新組裝。檔案開頭已經寫明 allowlist 綁住這些查詢文字。本文不建議、也不授權編輯它們。第 3 節的當前會議欄位都已經在鎖定的 `RACE_MEETINGS_QUERY` 內；不需要新查詢。旗標關閉時，預測讀的是鎖定的 `WIN_POOL_QUERY`。`GP_PACK_S` 精確等於字串 `1`，而且 `GP_FEATURE_CONDITIONS` 不是精確字串 `1` 時，同一路徑仍先讀這段獨贏查詢，再讀鎖定的 `RACE_MEETINGS_QUERY` 取當前會議排位。兩段字串的雜湊必須保持上表。`GP_FEATURE_CONDITIONS` 精確等於字串 `1` 時不走這條 Size S 路徑。

當前會議的 GraphQL 不按要求的日期或馬場篩選。`date` 與 `venue` 只用於 `type=official-results`。

已結束賽事只可使用官方賽果 HTML。現有讀取在 `api/officialResults.js`，頁面是 `https://racing.hkjc.com/zh-hk/local/information/resultsall`。它不是當前會議，不得取代 GraphQL，也不得被 `type=predict` 用來按日期或馬場查其他賽事。今日解析器從這頁得到場次、途程（能拆時）、名次、馬號、馬名、騎師姓名、練馬師姓名、實際負磅、檔位與派彩。場地與賽道字樣仍在 `detail` 原文。倉庫內樣本 `test/fixtures/official-results-2026-11-22-st.html` 的名次表沒有體重或配備欄；第 3 節所說的樣本就是這一份。本文不批准為了 Size S 改寫這個解析器。

現有網域維持不變：當前會議是 `https://info.cld.hkjc.com/graphql/base/`，已結束賽事是上面的官方賽果頁。不得改網域，不得加新主機。倉庫沒有憑證檔、沒有環境檔，也沒有 SSO 程式。本文不新增這些東西。

## 7. 驗收與評估（只到文件層）

本文沒有量度過 Size S。這裏沒有命中率、校準誤差、回報、提升幅度或樣本數。任何這類數字都不應被讀成已經量度的結果。本文也不預設及格線；預設一條尚未量度的及格線，就會變成假指標。

實作已合併。把旗標打開仍須另案批准，本文不構成該項核准。`test/packS.test.mjs` 已鎖定下列行為。這些測試不是命中率，也不是上線核准：

1. 旗標關閉時，同一組 `oddsNodes` 的預測與今日 `predictFromNodes` 一致，包括賠率回退 `99`、截斷、四捨五入、信心分檔、排序、前 5 筆，以及 `model` 字串。
2. 第 6 節兩段查詢字串的 SHA-256 與長度不變。
3. 當前會議仍只走 allowlist GraphQL；已結束賽事仍只走官方賽果 HTML；網域、憑證、環境與 SSO 不變。
4. 第 3 節每個特徵缺值時，該特徵不產生調整，馬匹仍有盤口基線，而且沒有用另一欄填補。
5. 第 5 節的資料沒有進入模型。配對鍵沒有被換成勝率。
6. 若要比較旗標開啟與關閉的命中，必須用已刊出的官方賽果做結算，再另行報告。本文沒有這份量度。結算標籤只可來自官方賽果，不得另找資料來源。

在獲准打開旗標之前，Size S 不得被稱為已經可以投入生產。本文沒有量度，也不是上線核准。

## 8. 隔離

`GP_PACK_S` 已實作，預設關閉。`api/packS.js` 的 `isPackSEnabled` 讀取它。只有環境值精確等於字串 `1` 才算開啟。該值不是這個精確字串，而且 `GP_FEATURE_CONDITIONS` 也不是精確字串 `1` 時，`type=predict` 使用獨贏賠率基線，與今日 `predictFromNodes` 逐位相同。

`GP_FEATURE_CONDITIONS` 精確等於字串 `1` 時，不使用 Size S 的獨贏賠率基線，也不使用 Size S 的係數。

係數是未經量度的實作預設，不是校準，也不是上線核准。本文件不把 `GP_PACK_S` 或 `GP_FEATURE_CONDITIONS` 寫成啟用。倉庫沒有環境檔把任一旗標打開。

這次文件補正只改正本規格的舊句。它不改 `api/races.js`、`api/packS.js`、`api/officialQueries.js`、`api/officialResults.js`、`index.html`、測試、工作流程、憑證、環境、網域或 SSO，也不把任一旗標寫成啟用。因此合併本文也不會改變今日預測。
