# あづまテラス 公式サイト（azuma-terrace）

墨田区立花の商店街「東あづま本通り会（愛称：あづまテラス）」の公式サイト。

**設計方針：「AIに読ませる名刺」** — 構造化データ（JSON-LD）を全ページに埋め込み、事実はテキストで明記し、静的で軽いHTMLで配信する。フレームワーク不使用。

## 仕組み

`data/` の JSON（器と中身を分離）と `templates/` を、`build.js`（Node標準ライブラリのみ）が読み込み、`dist/` に完成HTMLを出力するビルド方式。

```
data/           サイトデータ
  site.json     サイト基本情報
  shops.json    全41店（shop 32 / medical 9）
  events.json   イベント
templates/      レイアウト・部品・共通CSS
  layout.js     <head>・ヘッダー・フッター
  components.js 店舗/イベントカード、JSON-LD、genre→schema.org型 の変換
  styles.css    共通スタイル（dist/へコピー）
assets/         ロゴ（SVG。改変禁止）
build.js        ビルドスクリプト
dist/           生成物（.gitignore 対象）
```

## ビルド / プレビュー

```bash
node build.js          # dist/ に6ページ生成
npx serve dist         # ローカルプレビュー
```

## ページ

`index` / `events` / `shops` / `medical` / `access` / `about` の6ページ。

## デプロイ

Vercel 接続はオーナーが実施。`vercel.json` に `buildCommand: node build.js` / `outputDirectory: dist` を設定済み。

## 更新方法

店舗の営業時間・説明・URL などは `data/shops.json` の各店の該当フィールド（初期値 `null`）に追記し、`node build.js` を再実行するだけ。イベント追加は `data/events.json` に1件追加。
