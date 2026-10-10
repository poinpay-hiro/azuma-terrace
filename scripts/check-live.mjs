// 本番反映チェック（定型）。使い方: node scripts/check-live.mjs [ページ内に含まれるべき検索文字列 ...]
//
// 【司令塔条件・2026-07】ネットワーク接続先はコード内定数に固定。
//   接続先は自ドメイン(www.azuma-terrace.com / azuma-terrace.com)のみ。任意URL/ホスト名は引数・環境変数で受け付けない。
//   引数として受け付けるのは「ページ内に含まれるべき検索文字列」だけ（スラッシュや "http" を含む引数はエラー終了）。
import process from "node:process";
import fs from "node:fs";

// ---- 接続先（固定・変更禁止。ここ以外からURLを取らない） ----
const ORIGIN = "https://www.azuma-terrace.com";   // 本番 www（定数）
const APEX = "https://azuma-terrace.com";          // apex（定数・308確認用）
const BASE_PAGES = ["/", "/events", "/shops", "/medical", "/access", "/guidelines", "/sponsor", "/about"]; // 基本8ページ（/sponsor＝2026-10-10 追加）
// イベントの参加店一覧ページ（data/campaigns.json の slug）も確認対象に含める。
// パスはリポジトリ内のデータから作る（引数・環境変数からは受け取らない＝接続先固定の方針どおり）。
const PAGES = [...BASE_PAGES, ...readCampaignPaths()];
function readCampaignPaths() {
  try {
    const list = JSON.parse(fs.readFileSync(new URL("../data/campaigns.json", import.meta.url), "utf8"));
    return list.map((c) => c.slug).filter((s) => /^[a-z0-9-]+$/.test(s)).map((s) => `/${s}`);
  } catch { return []; }
}
const INSIGHTS = "/_vercel/insights/script.js"; // Vercel Web Analytics（本番が自動配信・定数）

// ---- 引数防御: URL/ホスト名の混入を拒否（検索文字列のみ許可） ----
const needles = process.argv.slice(2);
for (const a of needles) {
  if (a.includes("/") || /http/i.test(a)) {
    console.error(`ERROR: 引数にURL/ホスト名は指定できません（'/' や 'http' を含む引数は禁止）: ${JSON.stringify(a)}`);
    process.exit(2);
  }
}

const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass: !!pass, detail });

function jsonLdBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

(async () => {
  // 全7ページ取得
  const pages = {};
  const badStatus = [];
  for (const p of PAGES) {
    try {
      const res = await fetch(ORIGIN + p, { redirect: "follow" });
      const body = await res.text();
      pages[p] = { status: res.status, body };
      if (res.status !== 200) badStatus.push(`${p}=${res.status}`);
    } catch (e) {
      pages[p] = { status: 0, body: "" };
      badStatus.push(`${p}=ERR(${e.cause?.code || e.message})`);
    }
  }
  check(`全${PAGES.length}ページ HTTP 200`, badStatus.length === 0, badStatus.length ? badStatus.join(", ") : `${PAGES.length}ページ 200`);

  // トップに「あづまテラス」含有
  const top = pages["/"]?.body || "";
  check("トップに『あづまテラス』含有", top.includes("あづまテラス"), top.includes("あづまテラス") ? "含む" : "見つからない");

  // JSON-LD 件数＋パース
  let ld = 0, ldFail = 0;
  for (const p of PAGES) {
    for (const raw of jsonLdBlocks(pages[p]?.body || "")) {
      ld++;
      try { JSON.parse(raw); } catch { ldFail++; }
    }
  }
  check("JSON-LD 件数＋パース", ld > 0 && ldFail === 0, ldFail ? `${ldFail}件パース失敗` : `${ld}件すべてパース成功`);

  // apex → 308 で www へ
  try {
    const res = await fetch(APEX + "/", { redirect: "manual" });
    const loc = res.headers.get("location") || "";
    const ok = res.status === 308 && loc.startsWith(ORIGIN);
    check("apex 308→www リダイレクト", ok, `status=${res.status} location=${loc || "(なし)"}`);
  } catch (e) {
    check("apex 308→www リダイレクト", false, `ERR(${e.cause?.code || e.message})`);
  }

  // 計測タグ（Vercel Web Analytics）が本番の全ページHTMLに含まれる
  {
    const noTag = PAGES.filter((p) => !(pages[p]?.body || "").includes(`src="${INSIGHTS}"`));
    check("計測タグ 全ページ含有", noTag.length === 0, noTag.length ? `無し: ${noTag.join(", ")}` : `${PAGES.length}ページとも含有`);
  }

  // 計測スクリプト本体が 200 で配信されている
  try {
    const res = await fetch(ORIGIN + INSIGHTS, { redirect: "follow" });
    check("計測スクリプト 200配信", res.status === 200, `status=${res.status}`);
  } catch (e) {
    check("計測スクリプト 200配信", false, `ERR(${e.cause?.code || e.message})`);
  }

  // 引数の検索文字列（あれば）: いずれかのページに存在
  for (const needle of needles) {
    const hitPages = PAGES.filter((p) => (pages[p]?.body || "").includes(needle));
    check(`検索文字列 "${needle}" 存在`, hitPages.length > 0, hitPages.length ? `${hitPages.join(",")} に存在` : "どのページにも無し");
  }

  // 出力（verify.mjs と同形式）
  const pad = Math.max(...results.map((r) => r.name.length));
  let failed = 0;
  console.log(`── 本番チェック (check-live.mjs) @ ${ORIGIN} ──`);
  for (const r of results) {
    if (!r.pass) failed++;
    console.log(`${r.pass ? "PASS ✓" : "FAIL ✗"}  ${r.name.padEnd(pad)}  ${r.detail}`);
  }
  console.log("──────────────────────────");
  if (failed) { console.log(`結果: ${results.length - failed}/${results.length} PASS, ${failed} FAIL → 終了コード1`); process.exit(1); }
  console.log(`結果: 全 ${results.length} 項目 PASS`);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
