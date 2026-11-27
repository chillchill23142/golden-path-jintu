# golden-path-jintu
Golden Path · 金途 - Hong Kong horse racing data analysis dashboard

規格：[Size S：盤口基線 + 已有特徵調整](docs/pack-s-features-spec.md)。

獨立規格：[特徵先行條件](docs/feature-conditions-spec.md)。分析條件是跑道與路程、晨操與試閘觀察、配備、傷患、跑法、檔位、騎練配對鍵與已宣告負磅。獨贏與位置賠率不是分析條件，也不是基線。`GP_FEATURE_CONDITIONS` 預設關閉：只有環境值精確等於字串 `1` 才讀取公開晨操、試閘與傷患頁。未設定、空字串、`0` 以及其他值都維持今日的 `type=predict`，而且不會抓那些頁。啟用時缺值不填補；跑法沒有賽前官方分類就不調整，也不從沿途文字推斷。係數是未經量度的實作預設，不是校準，也不是上線核准。本倉庫沒有把這個旗標或 `GP_PACK_S` 寫成啟用。

`GP_PACK_S` 預設關閉。`GP_FEATURE_CONDITIONS` 不是精確字串 `1` 時，只有 `GP_PACK_S` 的值精確等於字串 `1`，`type=predict` 才會在獨贏 `oddsValue` 基線上套用有界調整。兩個旗標都不是該字串時，維持 `predictFromNodes`（只按當前會議獨贏賠率）。特徵條件啟用時不使用這條賠率基線，也不使用 Size S 的係數。檔位、已宣告負磅與體重的 Size S 係數是未經量度的實作預設，不是上線核准。跑道、途程、場地與配備不另建勝率表。騎師與練馬師只組成配對鍵，不計算勝率，也不調整概率。本倉庫沒有把旗標打開的環境檔，Size S 與特徵條件都未可投入生產。

草稿規格：[騎練勝率結算](docs/jockey-trainer-settlement-spec.md)。
