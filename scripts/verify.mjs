// あづまテラス 検品スクリプト（自動検品ループ用）
// 使い方: node build.js && node scripts/verify.mjs   （= npm run verify）
// 各項目を機械判定し PASS/FAIL と理由を出力。1つでもFAILなら終了コード1。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const DATA = path.join(ROOT, "data");

const REQUIRED_PAGES = ["index", "events", "shops", "medical", "access", "about"];
const IMG_EXT = /\.(jpe?g|png|svg|webp|gif|avif)$/i;
const SIZE_WARN = 1024 * 1024; // 1MB
const results = [];
const warnings = []; // 非致命（終了コードに影響しない）
function check(name, pass, detail) { results.push({ name, pass: !!pass, detail: detail || "" }); }

// --- helpers ---
function listFiles(dir, base = "") {
  const out = new Set();
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base + e.name;
    if (e.isDirectory()) for (const x of listFiles(path.join(dir, e.name), rel + "/")) out.add(x);
    else out.add(rel);
  }
  return out;
}
function readHtml(page) { return fs.readFileSync(path.join(DIST, page + ".html"), "utf8"); }
function jsonLdBlocks(html) {
  const out = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) out.push(m[1]);
  return out;
}

// ============ 1. 6ページ存在 ============
{
  const missing = REQUIRED_PAGES.filter((p) => !fs.existsSync(path.join(DIST, p + ".html")));
  check("6ページ生成", missing.length === 0, missing.length ? `不足: ${missing.join(", ")}` : `${REQUIRED_PAGES.length}ページ存在`);
}

const distFiles = listFiles(DIST);
const htmlPages = REQUIRED_PAGES.filter((p) => fs.existsSync(path.join(DIST, p + ".html")));

// ============ 2. 内部リンク切れゼロ ============
{
  const broken = [];
  for (const p of htmlPages) {
    const html = readHtml(p);
    const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
      .filter((u) => !/^(https?:|tel:|mailto:|#|data:)/.test(u));
    for (const r of refs) {
      const clean = r.split("#")[0].split("?")[0];
      if (!clean) continue;
      const ok = distFiles.has(clean) || distFiles.has(clean + ".html");
      if (!ok) broken.push(`${p}.html -> ${r}`);
    }
  }
  check("内部リンク切れゼロ", broken.length === 0, broken.length ? broken.slice(0, 8).join(" / ") : "全リンク解決");
}

// ============ 3. 全JSON-LDパース成功 ============
let allLd = []; // {page, obj}
{
  let total = 0, ok = 0; const fails = [];
  for (const p of htmlPages) {
    for (const raw of jsonLdBlocks(readHtml(p))) {
      total++;
      try { const obj = JSON.parse(raw); ok++; allLd.push({ page: p, obj }); }
      catch (e) { fails.push(`${p}.html: ${e.message}`); }
    }
  }
  check("JSON-LDパース成功", fails.length === 0, fails.length ? fails.slice(0, 5).join(" / ") : `${ok}/${total} ブロック`);
}

// ============ 4. 店舗JSON-LDの電話（+81形式 / null店にtelephone無し）============
{
  let shops = [];
  try { shops = JSON.parse(fs.readFileSync(path.join(DATA, "shops.json"), "utf8")); } catch (e) {}
  const telByName = new Map(shops.map((s) => [s.name, s.tel]));
  const problems = [];
  let checked = 0;
  for (const { obj } of allLd) {
    const t = obj["@type"];
    if (t === "ShoppingCenter" || t === "Event" || !obj.name || !telByName.has(obj.name)) continue;
    checked++;
    const expected = telByName.get(obj.name);
    if (expected === null || expected === undefined) {
      if ("telephone" in obj) problems.push(`${obj.name}: 電話null店なのに telephone="${obj.telephone}"`);
    } else {
      if (!obj.telephone) problems.push(`${obj.name}: telephone欠落`);
      else if (!/^\+81-\d[\d-]*\d$/.test(obj.telephone)) problems.push(`${obj.name}: +81形式でない (${obj.telephone})`);
    }
  }
  check("店舗電話 +81形式/null整合", problems.length === 0, problems.length ? problems.slice(0, 6).join(" / ") : `${checked}店を検証`);
}

// ============ 5. Event JSON-LD 必須項目 ============
{
  const events = allLd.filter((x) => x.obj["@type"] === "Event").map((x) => x.obj);
  const problems = [];
  for (const e of events) {
    const miss = ["name", "startDate", "location"].filter((k) => !e[k]);
    if (miss.length) problems.push(`${e.name || "(no name)"}: 欠落 ${miss.join(",")}`);
  }
  const pass = events.length > 0 && problems.length === 0;
  check("Event必須項目(name/startDate/location)", pass,
    events.length === 0 ? "Event JSON-LDが0件" : problems.length ? problems.join(" / ") : `${events.length}件すべて必須項目あり`);
}

// ============ 6. 秘密・不要物の混入検知（dist / git対象）============
{
  const bad = [];
  const isForbidden = (f) =>
    f.endsWith(".pdf") ||
    /(^|\/)assets\/guidelines\/[^/]+\.png$/.test(f) ||
    /(^|\/)\.env(\.|$)/.test(f) ||
    f === ".env" ||
    /(^|\/)\.claude(\/|$)/.test(f);

  // dist/ ツリー
  for (const f of distFiles) if (isForbidden("dist/" + f) || f.endsWith(".pdf") || /assets\/guidelines\/.+\.png$/.test(f)) bad.push("dist/" + f);

  // git 追跡ファイル + ステージング対象
  let gitFiles = [];
  try {
    const tracked = execSync("git ls-files", { cwd: ROOT }).toString().split("\n").filter(Boolean);
    let staged = [];
    try { staged = execSync("git diff --cached --name-only", { cwd: ROOT }).toString().split("\n").filter(Boolean); } catch {}
    gitFiles = [...new Set([...tracked, ...staged])];
  } catch { /* git無しなら dist チェックのみ */ }
  for (const f of gitFiles) if (isForbidden(f)) bad.push("git:" + f);

  check("秘密/不要物の非混入(*.pdf, guidelines/*.png, .env, .claude)", bad.length === 0,
    bad.length ? bad.slice(0, 8).join(" / ") : "混入なし");
}

// ============ 7. 画像の実在 ＋ サイズ上限1MB（超過は警告）============
{
  // ページが参照する画像（src/href の画像拡張子）が dist に存在するか
  const missing = [];
  for (const p of htmlPages) {
    const html = readHtml(p);
    const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
      .filter((u) => !/^(https?:|data:)/.test(u) && IMG_EXT.test(u));
    for (const r of refs) {
      const clean = r.split("#")[0].split("?")[0];
      if (!distFiles.has(clean)) missing.push(`${p}.html -> ${r}`);
    }
  }
  // dist内の画像ファイルのサイズ（1MB超は警告）
  let imgCount = 0;
  for (const f of distFiles) {
    if (!IMG_EXT.test(f)) continue;
    imgCount++;
    const size = fs.statSync(path.join(DIST, f)).size;
    if (size > SIZE_WARN) warnings.push(`画像1MB超: ${f} (${(size / 1024 / 1024).toFixed(2)}MB)`);
  }
  check("画像の実在(参照先が存在)", missing.length === 0,
    missing.length ? missing.slice(0, 8).join(" / ") : `参照画像すべて存在／dist内画像${imgCount}件をサイズ検査`);
}

// ============ 8. <title> と meta description が非空 ============
{
  const problems = [];
  for (const p of htmlPages) {
    const html = readHtml(p);
    const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const desc = (html.match(/<meta\s+name="description"\s+content="([^"]*)"/) || [])[1];
    if (!title || !title.trim()) problems.push(`${p}.html: <title>が空/無し`);
    if (desc === undefined) problems.push(`${p}.html: meta descriptionタグ無し`);
    else if (!desc.trim()) problems.push(`${p}.html: meta descriptionが空`);
  }
  check("title/meta description 非空", problems.length === 0,
    problems.length ? problems.slice(0, 6).join(" / ") : `${htmlPages.length}ページとも非空`);
}

// ============ 9. JSON-LD の @context 妥当性（＋@type存在）============
{
  const problems = [];
  for (const { page, obj } of allLd) {
    const ctx = obj["@context"];
    if (ctx !== "https://schema.org" && ctx !== "http://schema.org") {
      problems.push(`${page}.html: @context不正 (${JSON.stringify(ctx)})`);
    }
    if (!obj["@type"] || typeof obj["@type"] !== "string") {
      problems.push(`${page}.html: @type欠落`);
    }
  }
  check("JSON-LD @context妥当性", problems.length === 0,
    problems.length ? problems.slice(0, 6).join(" / ") : `${allLd.length}ブロックとも schema.org / @type有`);
}

// ============ 出力 ============
const pad = Math.max(...results.map((r) => r.name.length));
let failed = 0;
console.log("── 検品結果 (verify.mjs) ──");
for (const r of results) {
  if (!r.pass) failed++;
  const tag = r.pass ? "PASS ✓" : "FAIL ✗";
  console.log(`${tag}  ${r.name.padEnd(pad)}  ${r.detail}`);
}
console.log("──────────────────────────");
if (warnings.length) {
  console.log(`警告（非致命・${warnings.length}件）:`);
  for (const w of warnings) console.log(`  WARN △  ${w}`);
  console.log("──────────────────────────");
}
if (failed) { console.log(`結果: ${results.length - failed}/${results.length} PASS, ${failed} FAIL → 終了コード1`); process.exit(1); }
console.log(`結果: 全 ${results.length} 項目 PASS${warnings.length ? `（警告${warnings.length}件・終了コードには非影響）` : ""}`);
