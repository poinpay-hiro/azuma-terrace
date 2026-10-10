// あづまテラス 検品スクリプト（自動検品ループ用）
// 使い方: node build.js && node scripts/verify.mjs   （= npm run verify）
// 各項目を機械判定し PASS/FAIL/WARN と理由を出力。1つでもFAILなら終了コード1。
// WARN は push を止めない（終了コード0）が、report に必ず載せる（CLAUDE.md §1）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const DATA = path.join(ROOT, "data");

const BASE_PAGES = ["index", "events", "shops", "medical", "access", "guidelines", "sponsor", "about"]; // sponsor＝2026-10-10 追加
// イベントの参加店一覧ページ（data/campaigns.json の slug ごとに1ページ・2026-10-09）も生成の期待値に含める
let CAMPAIGNS = [];
try { CAMPAIGNS = JSON.parse(fs.readFileSync(path.join(DATA, "campaigns.json"), "utf8")); } catch (e) { CAMPAIGNS = null; }
const REQUIRED_PAGES = [...BASE_PAGES, ...(CAMPAIGNS || []).map((c) => c.slug)];
const IMG_EXT = /\.(jpe?g|png|svg|webp|gif|avif)$/i;
const SIZE_WARN = 1024 * 1024; // 1MB
// ビルド日（日本時間）。build.js のイベント状態判定と同じ式（UTC+9 の日付）。#11・#18 で使う。
const BUILD_DATE_JST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const results = [];
const warnings = []; // 非致命（終了コードに影響しない）
function check(name, pass, detail) { results.push({ name, status: pass ? "PASS" : "FAIL", detail: detail || "" }); }
// 非致命の検査項目（該当があっても終了コードに影響しない）。hit=true で WARN、false で PASS。
function warnCheck(name, hit, detail) { results.push({ name, status: hit ? "WARN" : "PASS", detail: detail || "" }); }

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

// ============ 1. 全ページ存在（基本7ページ＋参加店一覧ページ）============
{
  const missing = REQUIRED_PAGES.filter((p) => !fs.existsSync(path.join(DIST, p + ".html")));
  check(`${REQUIRED_PAGES.length}ページ生成(基本${BASE_PAGES.length}＋参加店一覧${REQUIRED_PAGES.length - BASE_PAGES.length})`, missing.length === 0, missing.length ? `不足: ${missing.join(", ")}` : `${REQUIRED_PAGES.length}ページ存在`);
}

const distFiles = listFiles(DIST);
const htmlPages = REQUIRED_PAGES.filter((p) => fs.existsSync(path.join(DIST, p + ".html")));

// Vercel プラットフォームが本番で自動配信するパス（dist には存在しない）。
// 内部リンク検査の対象外にするのはこの1本のみ（除外を広げないこと）。
// 実在の代わりに、項目15「全ページに計測タグ」で参照の有無を機械判定する。
const VERCEL_INSIGHTS = "/_vercel/insights/script.js";

// ============ 2. 内部リンク切れゼロ ============
{
  const broken = [];
  for (const p of htmlPages) {
    const html = readHtml(p);
    const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
      .filter((u) => !/^(https?:|tel:|mailto:|#|data:)/.test(u))
      .filter((u) => u !== VERCEL_INSIGHTS); // Vercel配信パス（上記コメント参照）
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

// git 追跡＋ステージング対象ファイル一覧（複数チェックで共用）
function gitList(cmd) { try { return execSync(cmd, { cwd: ROOT }).toString().split("\n").filter(Boolean); } catch { return null; } }
const gitTracked = gitList("git ls-files");
const gitStaged = gitList("git diff --cached --name-only") || [];
const gitAll = gitTracked ? [...new Set([...gitTracked, ...gitStaged])] : null;

// ============ 6. 秘密・不要物の混入検知（dist / git対象）============
// 注: assets/guidelines/**.png は「活動の手引き」画像として公開可（オーナー承認済み）→ 禁止対象から除外。
//     *.pdf / .env / .claude / dist / node_modules の禁止は維持。
//     .review-approved（push関所の通行証・ローカル限り）も禁止（CLAUDE.md §3）。
{
  const bad = [];
  const isForbidden = (f) =>
    f.endsWith(".pdf") ||
    /(^|\/)\.env(\.|$)/.test(f) ||
    f === ".env" ||
    /(^|\/)\.claude(\/|$)/.test(f) ||
    /(^|\/)\.review-approved$/.test(f);
  // dist/・node_modules/ が git 追跡されていないこと（生成物・依存の混入禁止）
  const isForbiddenInGit = (f) => isForbidden(f) || /^dist\//.test(f) || /(^|\/)node_modules\//.test(f);

  // dist/ ツリー（PDF・秘密ファイルが焼き込まれていないか）
  for (const f of distFiles) if (isForbidden(f)) bad.push("dist/" + f);
  // git 追跡ファイル + ステージング対象
  if (gitAll) for (const f of gitAll) if (isForbiddenInGit(f)) bad.push("git:" + f);

  check("秘密/不要物の非混入(*.pdf, .env, .claude, .review-approved, dist, node_modules)", bad.length === 0,
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

// ============ 10. 活動の手引き画像：git追跡済み ＋ 1枚1MB以下 ============
{
  const dir = path.join(ROOT, "assets", "guidelines");
  const problems = [];
  let count = 0;
  if (!fs.existsSync(dir)) {
    problems.push("assets/guidelines/ が存在しない");
  } else {
    const trackedSet = gitTracked ? new Set(gitTracked) : null;
    for (const f of fs.readdirSync(dir)) {
      if (!IMG_EXT.test(f)) continue;
      count++;
      const rel = `assets/guidelines/${f}`;
      const size = fs.statSync(path.join(dir, f)).size;
      if (size > SIZE_WARN) problems.push(`${rel}: 1MB超 (${(size / 1024 / 1024).toFixed(2)}MB)`);
      if (trackedSet && !trackedSet.has(rel)) problems.push(`${rel}: git未追跡`);
    }
    if (count === 0) problems.push("画像が0件");
  }
  check("手引き画像 git追跡済み＋1MB以下", problems.length === 0,
    problems.length ? problems.slice(0, 8).join(" / ") : `${count}枚すべて追跡済み・1MB以下`);
}

// ============ 11. events.html「これまでの開催」が dateStart 降順で並んでいる ============
// 期待値の「過去」は data の status ではなく日付で決める（build.js と同じ判定・CLAUDE.md §5 2026-09-26 裁定）。
//   dateEnd（無ければ dateStart）< ビルド日(JST) のイベントが、過不足なく dateStart 降順で並んでいること。
//   ⚠️ 旧実装は data の status==="past" で期待値を作っていたため、日付判定の導入後は「data を直さずに push」で
//      表示は正しいのに FAIL していた（2026-09-26 に日付判定へ揃えた。検査の対象・厳しさは変えていない）。
{
  let events = [];
  try { events = JSON.parse(fs.readFileSync(path.join(DATA, "events.json"), "utf8")); } catch (e) {}
  const expected = events
    .filter((e) => (e.dateEnd || e.dateStart) < BUILD_DATE_JST)
    .slice()
    .sort((a, b) => (a.dateStart < b.dateStart ? 1 : a.dateStart > b.dateStart ? -1 : 0))
    .map((e) => e.title);
  let detail = "", pass = true;
  const htmlPath = path.join(DIST, "events.html");
  if (!fs.existsSync(htmlPath)) { pass = false; detail = "events.html が無い"; }
  else {
    const html = fs.readFileSync(htmlPath, "utf8");
    const marker = html.indexOf("これまでの開催");
    if (marker < 0) { pass = false; detail = "「これまでの開催」見出しが無い"; }
    else {
      const tail = html.slice(marker);
      const actual = [...tail.matchAll(/<h3>([\s\S]*?)<\/h3>/g)].map((m) => m[1].trim());
      const same = actual.length === expected.length && actual.every((t, i) => t === expected[i]);
      pass = same;
      detail = same
        ? `過去${expected.length}件が dateStart 降順（${expected.join(" > ")}）`
        : `期待[${expected.join(" | ")}] ≠ 実際[${actual.join(" | ")}]`;
    }
  }
  check("events過去=dateStart降順", pass, detail);
}

// ============ 12. OGP: og:title / og:image / twitter:card ＋ og:image絶対URL＆実在 ============
{
  const BASE = "https://www.azuma-terrace.com/";
  const problems = [];
  for (const p of htmlPages) {
    const html = readHtml(p);
    const ogTitle = (html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1];
    const ogImage = (html.match(/<meta property="og:image" content="([^"]*)"/) || [])[1];
    const twCard = (html.match(/<meta name="twitter:card" content="([^"]*)"/) || [])[1];
    if (!ogTitle) problems.push(`${p}.html: og:title 無し`);
    if (!twCard) problems.push(`${p}.html: twitter:card 無し`);
    if (!ogImage) { problems.push(`${p}.html: og:image 無し`); continue; }
    if (!ogImage.startsWith(BASE)) { problems.push(`${p}.html: og:image が絶対URL(${BASE})でない (${ogImage})`); continue; }
    const rel = ogImage.slice(BASE.length).split("#")[0].split("?")[0];
    if (!distFiles.has(rel)) problems.push(`${p}.html: og:image 参照先が dist に無い (${rel})`);
  }
  check("OGP og:title/og:image/twitter:card", problems.length === 0,
    problems.length ? problems.slice(0, 8).join(" / ") : `${htmlPages.length}ページとも揃い・og:image絶対URL＆実在`);
}

// ============ 13. favicon.ico / apple-touch-icon.png が dist 直下に存在 ============
{
  const missing = ["favicon.ico", "apple-touch-icon.png"].filter((f) => !distFiles.has(f));
  check("favicon/apple-touch-icon 存在", missing.length === 0,
    missing.length ? `dist直下に無い: ${missing.join(", ")}` : "favicon.ico・apple-touch-icon.png あり");
}

// ============ 14. openingHours/closedDays の表記ルール適合 ============
{
  let shops = [];
  try { shops = JSON.parse(fs.readFileSync(path.join(DATA, "shops.json"), "utf8")); } catch (e) {}
  // 許可文字: 曜日1文字 / 数字 / : / 〜(U+301C) / ／(U+FF0F) / 、(U+3001) / ・(U+30FB) / 第 / 祝 / 半角スペース
  const ALLOWED = /^[月火水木金土日0-9:〜／、・第祝 ]+$/;
  const TIME_RANGE = /\d{1,2}:\d{2}〜\d{1,2}:\d{2}/;
  const problems = [];
  for (const s of shops) {
    for (const field of ["openingHours", "closedDays"]) {
      const v = s[field];
      if (!v) continue;
      if (/曜/.test(v)) problems.push(`${s.name}.${field}: 「曜」を含む`);
      if (/～/.test(v)) problems.push(`${s.name}.${field}: 全角チルダU+FF5Eを含む（U+301Cに統一）`);
      if (!ALLOWED.test(v)) problems.push(`${s.name}.${field}: 許可外の文字を含む`);
      if (v.includes(":") && !TIME_RANGE.test(v)) problems.push(`${s.name}.${field}: 時間が「9:00〜18:30」形式でない`);
    }
  }
  const n = shops.filter((s) => s.openingHours || s.closedDays).length;
  check("営業/診療時間の表記ルール適合", problems.length === 0,
    problems.length ? problems.slice(0, 8).join(" / ") : `該当${n}店すべて適合`);
}

// ============ 15. Vercel Web Analytics 計測タグが全ページにある ============
{
  const missing = [];
  for (const p of htmlPages) {
    const html = readHtml(p);
    if (!html.includes(`src="${VERCEL_INSIGHTS}"`)) missing.push(`${p}.html`);
  }
  check("計測タグ(Vercel Analytics)全ページ", missing.length === 0,
    missing.length ? `無し: ${missing.join(", ")}` : `${htmlPages.length}ページとも計測タグあり`);
}

// ============ 16. 秘密パターン走査（git 追跡ファイル＋ステージング中ファイルの中身）============
// ファイル名ではなく「値の形」で検知する（#6 はファイル名ベース）。azuma に秘密は無い前提を機械的に保つ網。
// 高シグナルな形のみ（長さ・区切りまで指定して誤検知を抑える）。バイナリ拡張子とこのスクリプト自身は除外。
{
  const SECRET_PATTERNS = [
    ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
    ["GitHub fine-grained PAT", /\bgithub_pat_[A-Za-z0-9_]{22,}/],
    ["OpenAI/Anthropic 形式キー", /(^|[^A-Za-z0-9_-])sk-(?:proj-|ant-[a-z0-9]+-)?[A-Za-z0-9_-]{20,}/],
    ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
    ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
    ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
    ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
    ["秘密鍵", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ];
  const BINARY_EXT = /\.(jpe?g|png|gif|webp|avif|ico|pdf|woff2?|ttf|otf|zip|bundle)$/i;
  const SELF = "scripts/verify.mjs";
  const hits = [];
  let scanned = 0;
  const scan = (label, text) => {
    scanned++;
    for (const [kind, re] of SECRET_PATTERNS) if (re.test(text)) hits.push(`${label}: ${kind}`);
  };
  if (gitTracked === null) {
    check("秘密パターン走査(追跡＋ステージング)", false, "git ls-files に失敗（走査できず）");
  } else {
    for (const f of gitTracked) {
      if (f === SELF || BINARY_EXT.test(f)) continue;
      const abs = path.join(ROOT, f);
      if (!fs.existsSync(abs)) continue; // 作業ツリーで削除済み
      scan(f, fs.readFileSync(abs, "utf8"));
    }
    // ステージング中の中身（index 側。未追跡の新規ファイルもここで捕捉）
    for (const f of gitStaged) {
      if (f === SELF || BINARY_EXT.test(f)) continue;
      let text;
      try { text = execSync(`git show ":${f}"`, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString(); } catch { continue; } // 削除のステージング
      scan(`(staged) ${f}`, text);
    }
    // 値そのものは出力しない（ファイル名と種類のみ）
    check("秘密パターン走査(追跡＋ステージング)", hits.length === 0,
      hits.length ? hits.slice(0, 8).join(" / ") : `${scanned}ファイルに秘密パターンなし`);
  }
}

// ============ 17. 個人携帯番号の検知（data/*.json・WARN）============
// 090/080/070 で始まる番号は個人携帯の可能性（CLAUDE.md §4-2：個人携帯はリポジトリに入れない）。
// 店舗の代表番号として正当なものは MOBILE_ALLOWLIST に「店舗ID: 根拠」で登録する。
// ⚠️ allowlist への追加は裁定事項（勝手に追加しない。追加＝その番号の公開を容認すること）。
// 出力には番号そのものを出さない（店舗IDと項目名のみ）。
{
  const MOBILE_ALLOWLIST = {
    // "shop-id": "根拠（例: 提出書類で店舗代表番号と確認・YYYY-MM-DD 裁定）",
    "uzu-shokudo": "店舗のスマホ＝代表番号・オーナー裁定 2026-09-21（ops_orders id=19）",
    "uogin-stand": "店舗の代表番号として公開済み・オーナー裁定 2026-10-09（ops_orders id=27）",
    "xiaolongbao-shinka": "店舗の代表番号として公開済み・オーナー裁定 2026-10-09（ops_orders id=27）",
    "rekimama": "店舗の代表番号として公開済み・オーナー裁定 2026-10-09（ops_orders id=27）",
  };
  const MOBILE_RE = /(^|[^0-9])0[789]0[-\s]?\d{4}[-\s]?\d{4}(?![0-9])/;
  const found = [];
  for (const f of fs.readdirSync(DATA).filter((x) => x.endsWith(".json"))) {
    const walk = (o, p, id) => {
      if (typeof o === "string") {
        if (MOBILE_RE.test(o) && !(id && MOBILE_ALLOWLIST[id])) found.push(`${f}:${id || "-"}(${p.replace(/^\./, "").replace(/^\d+\./, "")})`);
      } else if (o && typeof o === "object") {
        const nid = typeof o.id === "string" ? o.id : id;
        for (const k of Object.keys(o)) walk(o[k], `${p}.${k}`, nid);
      }
    };
    walk(JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")), "", null);
  }
  const allowed = Object.keys(MOBILE_ALLOWLIST).length;
  warnCheck("個人携帯番号の検知(data/*.json)", found.length > 0,
    found.length
      ? `携帯形式の番号 ${found.length}件（allowlist外・要裁定）: ${found.join(", ")}`
      : `該当なし（allowlist ${allowed}件）`);
}

// ============ 18. イベント data の status と日付の食い違い（WARN）============
// 表示上の状態は build.js が日付（日本時間のビルド日）で自動判定する（CLAUDE.md §5・2026-09-26 裁定）。
// data の status は表示に使われないが、残したまま古くなると読み手（人・AI）を誤らせるため、
// 「status=upcoming なのに dateEnd（無ければ dateStart）がビルド日より前」を WARN で知らせる（FAIL にはしない）。
// ビルド日は冒頭の BUILD_DATE_JST（build.js と同じ式）。
{
  let evs = [];
  try { evs = JSON.parse(fs.readFileSync(path.join(DATA, "events.json"), "utf8")); } catch (e) {}
  const stale = evs.filter((e) => e.status === "upcoming" && (e.dateEnd || e.dateStart) < BUILD_DATE_JST);
  warnCheck("イベント status と日付の整合(upcomingなのに終了済み)", stale.length > 0,
    stale.length
      ? `ビルド日(JST) ${BUILD_DATE_JST} より前に終了しているのに status=upcoming: ${stale.map((e) => `${e.id}(${e.dateEnd || e.dateStart})`).join(", ")}（表示は日付判定で過去扱い済み。data の status を past に直すと解消）`
      : `該当なし（${evs.length}件・ビルド日(JST) ${BUILD_DATE_JST}）`);
}

// ============ 19. 参加店一覧（data/campaigns.json）の shopId が shops.json に全件存在 ============
// 店は shops.json の id で参照する設計（CLAUDE.md §5 2026-10-09）。参照切れは「載るはずの店が載らない」事故になるため FAIL。
// あわせて、同じ店の重複登録と、campaigns.json が読めない状態も FAIL にする。
{
  const problems = [];
  let shopIds = new Set();
  try { shopIds = new Set(JSON.parse(fs.readFileSync(path.join(DATA, "shops.json"), "utf8")).map((s) => s.id)); } catch (e) { problems.push("shops.json を読めない"); }
  if (CAMPAIGNS === null) problems.push("campaigns.json を読めない");
  let n = 0;
  for (const c of CAMPAIGNS || []) {
    const seen = new Set();
    for (const p of c.participants || []) {
      n++;
      if (!shopIds.has(p.shopId)) problems.push(`${c.slug}: shops.json に無い shopId「${p.shopId}」`);
      if (seen.has(p.shopId)) problems.push(`${c.slug}: shopId「${p.shopId}」が重複`);
      seen.add(p.shopId);
    }
  }
  check("参加店一覧の shopId 参照(campaigns.json→shops.json)", problems.length === 0,
    problems.length ? problems.slice(0, 8).join(" / ") : `${(CAMPAIGNS || []).length}件の一覧・${n}店すべて shops.json に存在・重複なし`);
}

// ============ 20. 参加店一覧のデジタル商品券の利用期間（voucherFrom / voucherUntil）の形式と前後関係 ============
// 期限はデータで持ち、表示（期間の表示・期限後の「終了しました」）は build 時に組み立てる（2026-10-09 オーナー裁定・ops_orders id=29）。
// 形式が崩れると期限後の切り替えが働かないため FAIL。片方だけの記載も FAIL。どちらも無い一覧は対象外。
{
  const problems = [];
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+09:00$/;
  let n = 0;
  for (const c of CAMPAIGNS || []) {
    const has = [c.voucherFrom, c.voucherUntil].filter((v) => v !== undefined && v !== null).length;
    if (has === 0) continue;
    n++;
    if (has === 1) { problems.push(`${c.slug}: voucherFrom と voucherUntil の片方だけ`); continue; }
    if (!(DATE.test(c.voucherFrom) || DATETIME.test(c.voucherFrom))) problems.push(`${c.slug}: voucherFrom の形式（YYYY-MM-DD か YYYY-MM-DDTHH:MM+09:00）`);
    if (!DATE.test(c.voucherUntil)) problems.push(`${c.slug}: voucherUntil の形式（YYYY-MM-DD）`);
    else if (!(c.voucherUntil > String(c.voucherFrom).slice(0, 10))) problems.push(`${c.slug}: voucherUntil（${c.voucherUntil}）が voucherFrom より後でない`);
  }
  check("参加店一覧の商品券利用期間(voucherFrom/Until)の形式と前後", problems.length === 0,
    problems.length ? problems.join(" / ") : n ? `${n}件の一覧で形式OK・期限が開始より後` : "該当なし（利用期間の記載なし）");
}

// ============ 21. 協賛・PRブース案内（/sponsor）の問い合わせ導線 ============
// 企業・団体からの相談の入口なので、公式LINE（主）とメール（副・件名入り mailto）の両方のリンクがあることを確かめる（2026-10-10）。
{
  const problems = [];
  let lineUrl = "";
  try { lineUrl = JSON.parse(fs.readFileSync(path.join(DATA, "site.json"), "utf8")).lineUrl || ""; } catch (e) { problems.push("site.json を読めない"); }
  const p = path.join(DIST, "sponsor.html");
  if (!fs.existsSync(p)) problems.push("sponsor.html が無い");
  else {
    const html = fs.readFileSync(p, "utf8");
    if (!lineUrl || !html.includes(`href="${lineUrl}"`)) problems.push("公式LINEのリンクが無い");
    if (!/href="mailto:[^"]+\?subject=/.test(html)) problems.push("件名入りの mailto リンクが無い");
  }
  check("協賛ページの問い合わせ導線(公式LINE＋件名入りmailto)", problems.length === 0, problems.length ? problems.join(" / ") : "公式LINE・件名入り mailto とも存在");
}

// ============ 出力 ============
const pad = Math.max(...results.map((r) => r.name.length));
const TAG = { PASS: "PASS ✓", FAIL: "FAIL ✗", WARN: "WARN △" };
let failed = 0;
let warned = 0;
console.log("── 検品結果 (verify.mjs) ──");
for (const r of results) {
  if (r.status === "FAIL") failed++;
  if (r.status === "WARN") warned++;
  console.log(`${TAG[r.status]}  ${r.name.padEnd(pad)}  ${r.detail}`);
}
console.log("──────────────────────────");
if (warnings.length) {
  console.log(`警告（非致命・${warnings.length}件）:`);
  for (const w of warnings) console.log(`  WARN △  ${w}`);
  console.log("──────────────────────────");
}
const passed = results.length - failed - warned;
const warnNote = warned || warnings.length ? `（WARN ${warned}項目・警告${warnings.length}件は終了コードに非影響。report に必ず記載）` : "";
if (failed) { console.log(`結果: ${results.length}項目中 PASS ${passed}・WARN ${warned}・FAIL ${failed} → 終了コード1`); process.exit(1); }
console.log(warned ? `結果: ${results.length}項目中 PASS ${passed}・WARN ${warned}・FAIL 0${warnNote}` : `結果: 全 ${results.length} 項目 PASS${warnNote}`);
