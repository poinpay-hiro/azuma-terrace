# CLAUDE.md — あづまテラス公式サイト 作業ガイド

> このファイルは Claude Code が毎回自動で読み込む「共通の下敷き」です。
> どのモデルで作業する場合も、まずこれを読み、記載のルールに従ってください。

---

## 0. プロジェクト概要

- **名称**: 東あづま本通り会（愛称：あづまテラス／azuma terrace）公式サイト
- **方針**:「AIに読ませる名刺」= 構造化データ(JSON-LD)必須・事実はテキスト明記・静的で軽いHTML・装飾JSは最小限。
- **構成**: フレームワーク不使用。`build.js`（Node標準ライブラリのみ）が `data/*.json` ＋ `templates/` を読み `dist/` に6ページ生成（index/events/shops/medical/access/about）。`dist/` は `.gitignore` 対象で、Vercel がビルド時に `node build.js` で生成する（`vercel.json`）。
- **データ**: 器と中身を分離。`data/site.json`・`data/shops.json`（全42店 shop33/medical9）・`data/events.json`。店舗の営業時間等は各店の null フィールドに追記→再ビルドで反映。
- **アセット**: `assets/` にロゴSVG（改変禁止）、`assets/guidelines/*.jpg`（活動の手引きの分割画像。about に掲載）。
- リポジトリ: GitHub `poinpay-hiro/azuma-terrace`（Public）。独自ドメイン/DNS はオーナーが後日。

---

## 1. 自動検品ループ運用（今後の全変更に適用する標準ループ）

**目的**: ビルド後の検品を人間の確認なしで回し、PASSした完成品だけが報告される体制。

### 実行するもの
- 検品スクリプト: `scripts/verify.mjs`（1ファイルに集約）。`npm run verify`（= `node build.js && node scripts/verify.mjs`）で実行。
- 検品項目（1つでもFAILなら終了コード1）:
  1. `dist/` に6ページ（index/events/shops/medical/access/about）が存在
  2. 全ページの内部リンク切れゼロ（assets含む）
  3. 全 JSON-LD ブロックがパース成功
  4. 店舗 JSON-LD の電話が `+81` 形式／電話 null の店に `telephone` キーが無い
  5. Event の JSON-LD が必須項目（name/startDate/location）を持つ
  6. `dist/` とステージング対象に `*.pdf` / `assets/guidelines/**.png` / `.env` / `.claude` が含まれない（秘密・不要物の混入検知）

### ループの運用ルール（厳守）
- **サイトに変更を加えたら、必ず `npm run verify` を実行する。**
- **FAIL があれば、自分で原因を特定・修正して再実行する。全PASSになるまで人間に報告せず自走する（ループ上限10回）。** 10回を超えても全PASSにならなければ、状況を整理して人間に相談する。
- **全PASS後に報告する。** 報告には ①変更内容 ②検品結果（全項目PASSの出力を貼る）③diffと説明の一致（実際の差分と説明が食い違っていないかの自己監査）を必ず含める。
- **検品スクリプト（verify.mjs）自体を変更する場合は、その理由を報告に明記する。検品を弱める変更（項目削除・条件緩和）は事前承認必須**（勝手に緩めない）。

---

## 2. 報告のルール

- **完了報告は必ず `~/Downloads/report.md` に上書き保存してから、チャットに要約を返す**（会話の記憶に頼らない）。
- 報告言語は日本語。提案・懸念は「提案」として本文から分離して書く。他チームに有用な教訓があれば末尾に【共有候補】を1行。

---

## 3. コミット / デプロイ規律

- **`git add -A` 禁止。コミットは対象ファイルを明示指定する。**
- 秘密情報（`.env` 等）・元PDF（`*.pdf`）・生成物（`dist/`）・`node_modules/`・`.claude/` はコミットしない（`.gitignore` 済み。verify の項目6でも二重チェック）。
- `main` へ push すると Vercel が自動デプロイ（接続後）。push は指示に沿って行う。
- 参考: バイナリ多めのコミットで `git push` が HTTP 400（RPC failed / sideband disconnect）になったら、`git config http.postBuffer 524288000` ＋ `git config http.version HTTP/1.1`（本リポジトリにローカル設定済み）で回避できる。

---

## 4. 変更時の自問（品質の下敷き）

1. データ（店舗・イベント）を足す/直すときは、必ず `npm run verify` を通す。特に電話は表示用文字列で持ち、JSON-LD 側で `+81` 形式に変換される（`templates/components.js`）。
2. RLS/認証などバックエンドは無い（静的サイト）。個人情報（役員氏名・掲載除外店・個人携帯）はリポジトリに入れない。
3. ロゴの変形・反転・色変更は禁止（ブランドガイドライン）。
