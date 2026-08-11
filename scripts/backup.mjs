// 節目バックアップ（定型）。使い方: node scripts/backup.mjs （引数なし・固定処理）
//
// 【安全条件】このスクリプトはネットワークに一切接続しない（fetch/http を使わない・ローカルファイル操作のみ）。
//   入出力のパスはすべてコード内定数。引数・環境変数でパスを受け付けない（誤った場所への書き出しを構造的に防ぐ）。
//   書き込むのは ~/Dropbox/azuma-backups/ 配下のみ。リポジトリと原本ディレクトリは読むだけで変更しない。
//
// 出力（同日に再実行した場合は上書き）:
//   azuma-assets_YYYY-MM-DD.zip           … ~/Downloads/azuma-assets/ 一式（原本PDF。*.pdf は .gitignore のためgitに載らない）
//   azuma-terrace_repo_YYYY-MM-DD.bundle  … git bundle --all（全履歴を1ファイル化。GitHubが失われても復元可）
//   claude-settings_YYYY-MM-DD.json       … .claude/settings.local.json のコピー（gitignore対象・許可設定）
//
// 設定記録（azuma-settings_YYYY-MM-DD.md）は手書きのため本スクリプトの対象外。設定変更のたびに新しい日付で作り直す。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// ---- パス（固定・変更禁止。ここ以外からパスを取らない） ----
const HOME = os.homedir();
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS_SRC = path.join(HOME, "Downloads", "azuma-assets"); // 原本PDF置き場（リポジトリ外）
const DEST_DIR = path.join(HOME, "Dropbox", "azuma-backups");    // 保存先（Dropbox）
const CLAUDE_SETTINGS = path.join(REPO, ".claude", "settings.local.json");

// ---- 引数防御: 引数は受け付けない（固定処理） ----
if (process.argv.length > 2) {
  console.error("ERROR: このスクリプトは引数を受け付けません（入出力パスは固定）。使い方: node scripts/backup.mjs");
  process.exit(2);
}

const today = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

const fmtBytes = (n) => {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
};

const made = [];
const fail = (msg) => { console.error(`ERROR: ${msg}`); process.exit(1); };

// ---- 事前チェック ----
if (!fs.existsSync(path.join(HOME, "Dropbox"))) fail(`~/Dropbox が見つかりません（Dropboxが未同期・未インストールの可能性）: ${path.join(HOME, "Dropbox")}`);
if (!fs.existsSync(ASSETS_SRC)) fail(`原本ディレクトリが見つかりません: ${ASSETS_SRC}`);
fs.mkdirSync(DEST_DIR, { recursive: true });

console.log(`── 節目バックアップ (backup.mjs) ${today} ──`);
console.log(`保存先: ${DEST_DIR}`);

// ---- (a) 原本PDF一式を zip ----
{
  const out = path.join(DEST_DIR, `azuma-assets_${today}.zip`);
  fs.rmSync(out, { force: true }); // zip は既存アーカイブに追記するため、上書きのため先に削除する
  // cwd を親にして親フォルダ名ごと固める（展開時に azuma-assets/ ができる）。-X: mac固有メタデータを入れない
  execFileSync("zip", ["-r", "-X", "-q", out, path.basename(ASSETS_SRC)], { cwd: path.dirname(ASSETS_SRC), stdio: ["ignore", "inherit", "inherit"] });
  if (!fs.existsSync(out)) fail(`zip の作成に失敗しました: ${out}`);
  const files = fs.readdirSync(ASSETS_SRC).filter((f) => !f.startsWith("."));
  made.push({ name: path.basename(out), bytes: fs.statSync(out).size, note: `原本 ${files.length} ファイル` });
}

// ---- (b) リポジトリ全履歴を git bundle ----
{
  const out = path.join(DEST_DIR, `azuma-terrace_repo_${today}.bundle`);
  fs.rmSync(out, { force: true });
  execFileSync("git", ["bundle", "create", out, "--all"], { cwd: REPO, stdio: ["ignore", "inherit", "inherit"] });
  if (!fs.existsSync(out)) fail(`git bundle の作成に失敗しました: ${out}`);
  const commits = execFileSync("git", ["rev-list", "--count", "--all"], { cwd: REPO, encoding: "utf8" }).trim();
  made.push({ name: path.basename(out), bytes: fs.statSync(out).size, note: `${commits} コミット（全履歴）` });
}

// ---- (c) Claude 許可設定のコピー ----
{
  const out = path.join(DEST_DIR, `claude-settings_${today}.json`);
  if (fs.existsSync(CLAUDE_SETTINGS)) {
    fs.copyFileSync(CLAUDE_SETTINGS, out);
    made.push({ name: path.basename(out), bytes: fs.statSync(out).size, note: ".claude/settings.local.json" });
  } else {
    console.log(`SKIP  ${path.basename(out)}  （${CLAUDE_SETTINGS} が存在しないためスキップ）`);
  }
}

// ---- 出力サマリ ----
const pad = Math.max(...made.map((m) => m.name.length));
console.log("──────────────────────────");
for (const m of made) console.log(`OK ✓  ${m.name.padEnd(pad)}  ${fmtBytes(m.bytes).padStart(8)}  ${m.note}`);

// 設定記録（手書き・任意日付）の有無も参考表示する
const settingsDocs = fs.readdirSync(DEST_DIR).filter((f) => /^azuma-settings_\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
const latest = settingsDocs[settingsDocs.length - 1];
console.log("──────────────────────────");
console.log(latest
  ? `設定記録: ${latest}（最新）${settingsDocs.length > 1 ? ` ほか${settingsDocs.length - 1}件` : ""}`
  : "設定記録: 無し → azuma-settings_YYYY-MM-DD.md を手書きで作成してください");
console.log(`結果: ${made.length} ファイル出力`);
