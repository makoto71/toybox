# あたらしいおもちゃ アイディア集

メディアアート的な驚きのある新アプリ案。各ファイルに概要(日)・実装方法(英)を記載。

| # | タイトル | 主な技術 | 実装コスト |
|---|---|---|---|
| 01 | [およぎだす すいぞくかん](01-oyogidasu-suizokukan.md) | three.js + canvas texture | 中 |
| 02 | [こえのはなび](02-koe-no-hanabi.md) | Web Audio + GPU particles | 低〜中 |
| 03 | [かげえの どうぶつえん](03-kage-no-doubutsuen.md) | MediaPipe Hands | 中 |
| 04 | [からだで ひかりのおえかき](04-karada-de-light-painting.md) | MediaPipe Pose + three.js | 中 |
| 05 | [ことばのあめ](05-kotoba-no-ame.md) | Web Speech + physics | 中 |
| 06 | [かおモンスター](06-kao-monster.md) | MediaPipe Face blendshapes | 中 |
| 07 | [いきで ふくせかい](07-iki-de-fuku-sekai.md) | Web Audio (breath) + three.js | 中 |
| 08 | [てのひら テルミン](08-tenohira-theremin.md) | MediaPipe Hands + Web Audio | 中 |
| 09 | [ちいさな ほしのにわ](09-chiisana-hoshi-no-niwa.md) | three.js (no camera/mic) | 中〜高 |
| 10 | [かがみの まんげきょう](10-kagami-no-mangekyou.md) | WebGL shader (camera) | **低** |
| 11 | [ゆびさき プラネタリウム](11-yoru-no-mado-planetarium.md) | three.js + gyro | 低〜中 |
| 12 | [じぶんが ふる すなあらし](12-sunafurikko.md) | Selfie Segmentation + GPGPU | 高 |
| 13 | [じかんのかがみ](13-jikan-no-kagami.md) | WebGL slit-scan (camera) | **低** |
| 14 | [てのひらの こびと](14-tenohira-no-kobito.md) | MediaPipe Hands + three.js | 中 |
| 15 | [ピクセルのむれ](15-pixel-no-mure.md) | GPGPU particle mirror | 中 |
| 16 | [こおりのまど](16-koori-no-mado.md) | shader sim + touch/breath | 低〜中 |
| 17 | [おとで みえる せかい](17-oto-de-mieru-sekai.md) | mic transient + three.js | 中 |
| 18 | [ハミングねんど](18-humming-nendo.md) | Web Audio pitch + LatheGeometry | 中 |
| 19 | [きりがみ まほう](19-kirigami-mahou.md) | 2D symmetry + three.js unfold | 中 |
| 20 | [かたむける おもちゃばこ](20-katamukeru-omochabako.md) | gyro + physics (rapier) | 中 |
| 21 | [かべのあな](21-kabe-no-ana.md) | MediaPipe Pose/Segmentation | 中〜高 |
| 22 | [ひかる プランクトンの うみ](22-hikaru-plankton-no-umi.md) | GPU fluid + GPGPU particles | 中 |
| 23 | [かこの じぶんと おどる](23-kako-no-jibun-to-odoru.md) | Selfie Segmentation + delay buffer | 中 |
| 24 | [つんつん じせいりゅうたい](24-tsuntsun-jiseiryuutai.md) | raymarched SDF shader | 中 |

## 入力モダリティ別
- **カメラ(体・手・顔)**: 03, 04, 06, 08, 10, 12, 13, 14, 15, 21, 23
- **マイク(声・息)**: 02, 05, 07, 17, 18 (+16, 22, 24 は補助的に使用)
- **タッチ/ジャイロのみ** (カメラ権限不要): 09, 11, 19, 20, 22, 24 (16はカメラなしモード可, 17はタップ代替可)
- **おえかき起点** (既存おえかきアプリと親和性高): 01, 09, 11, 16

## まず作るなら
1. **10 まんげきょう** — 最小コードで最大の見栄え。シェーダー1枚で成立
2. **02 こえのはなび** — マイク権限だけで完結、演出が映える
3. **01 すいぞくかん** — 既存おえかき資産を活かせる王道ヒット枠

### 第2弾 (13〜24) のおすすめ
1. **13 じかんのかがみ** — リングバッファ+シェーダー1枚で美術館級の驚き。最小コスト
2. **24 じせいりゅうたい** — フルスクリーンシェーダー1枚、権限不要、SNS映え最強
3. **20 おもちゃばこ** — UIゼロで1歳児から遊べる。物理エンジン任せで実装も素直
