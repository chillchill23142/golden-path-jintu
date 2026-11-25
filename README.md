# golden-path-jintu
Golden Path · 金途 - Hong Kong horse racing data analysis dashboard

規格：[Size S：盤口基線 + 已有特徵調整](docs/pack-s-features-spec.md)。

`GP_PACK_S` 預設關閉。只有環境變數的值精確等於字串 `1` 時，`type=predict` 才會在獨贏 `oddsValue` 基線上套用有界調整。未設定、空字串、`0` 以及其他任何值，都維持 `predictFromNodes`（只按當前會議獨贏賠率）。檔位、已宣告負磅與體重的係數是未經量度的實作預設，不是上線核准。跑道、途程、場地與配備不另建勝率表。騎師與練馬師只組成配對鍵，不計算勝率，也不調整概率。本倉庫沒有把旗標打開的環境檔，Size S 亦未可投入生產。
