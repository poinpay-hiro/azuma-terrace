"use strict";
/*
 * あづまテラス 公式サイト ビルドスクリプト
 * フレームワーク不使用。/data の JSON と /templates を読み、/dist に静的HTMLを生成する。
 * 実行: node build.js
 */
const fs = require("fs");
const path = require("path");
const { layout, esc } = require("./templates/layout");
const C = require("./templates/components");

const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
const DIST = path.join(ROOT, "dist");
const ASSETS = path.join(ROOT, "assets");

function readJSON(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8"));
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) n += copyDir(s, d);
    else { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

const site = readJSON("site.json");
const shops = readJSON("shops.json");
// イベントの表示上の状態（開催予定/開催中/過去）は、data の status ではなく
// 「ビルド日（日本時間）と dateStart / dateEnd の比較」で決める（CLAUDE.md §5・2026-09-26 オーナー裁定）。
//   dateEnd（無ければ dateStart）< ビルド日 → past ／ dateStart ≦ ビルド日 → ongoing ／ それ以外 → upcoming
// Vercel のビルドは UTC で動くため、UTC+9 に寄せてから日付を取る（日本時間の朝9時前に前日扱いになるのを防ぐ）。
// 判定はビルド時点で固定される＝終了したイベントは次の push（再ビルド）で自動的に過去へ移る。
const BUILD_DATE_JST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
function displayStatus(e) {
  const end = e.dateEnd || e.dateStart;
  if (end < BUILD_DATE_JST) return "past";
  if (e.dateStart <= BUILD_DATE_JST) return "ongoing";
  return "upcoming";
}
// 画像の寸法（px）をファイルのヘッダから読む（Node 標準のみ・JPEG と PNG に対応）。
// イベントカードの <img width/height> を画像ごとに正しく出すため（固定値の撤廃・ops_orders id=22）。
// 読めない場合は build を止める（寸法の誤った img を黙って出さない）。
function readImageSize(file) {
  const b = fs.readFileSync(file);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; // PNG IHDR
  if (b[0] === 0xff && b[1] === 0xd8) { // JPEG: SOFn マーカー（C4/C8/CC 以外の C0〜CF）の高さ・幅を読む
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  throw new Error(`画像の寸法を読めません: ${path.relative(ROOT, file)}`);
}

// イベントの参加店一覧（data/campaigns.json → /<slug> ページを自動生成・CLAUDE.md §5 2026-10-09）。
// 店は shops.json の id で参照し、店名・住所・電話はここで shops.json から引く（campaigns.json に複製しない）。
// 見つからない id があれば build を止める（推測で紐づけない）。集計（参加数など）は固定で持たず、ここで算出する。
const campaigns = readJSON("campaigns.json").map((c) => {
  const missing = c.participants.filter((p) => !shops.some((s) => s.id === p.shopId)).map((p) => p.shopId);
  if (missing.length) throw new Error(`campaigns.json（${c.slug}）の shopId が shops.json にありません: ${missing.join(", ")}`);
  return {
    ...c,
    page: `${c.slug}.html`,
    entries: c.participants.map((p) => ({ ...p, shop: shops.find((s) => s.id === p.shopId) })),
    counts: {
      stampRally: c.participants.filter((p) => p.stampRally).length,
      voucher: c.participants.filter((p) => p.voucher).length,
      isNew: c.participants.filter((p) => p.isNew).length,
    },
    ended: c.period.end < BUILD_DATE_JST, // 期間を過ぎたら冒頭に「終了しました」を自動表示
    // デジタル商品券の利用期限（voucherUntil・日付）。日本時間のビルド日が過ぎたら注記を「終了しました」に切り替える。
    // イベント本体の ended とは独立に判定する（2026-10-09 オーナー裁定・ops_orders id=29）。
    voucherEnded: c.voucherUntil ? c.voucherUntil < BUILD_DATE_JST : false,
  };
});

// 以降のページ生成（カード・JSON-LD・並べ替え）はすべて判定後の status を使う。data の status は参照しない。
const events = readJSON("events.json").map((e) => {
  const out = { ...e, status: displayStatus(e) };
  const camp = campaigns.find((c) => c.eventId === e.id);
  if (camp) out.campaignLink = { href: camp.page, label: "スタンプラリー参加店・商品券取扱店はこちら" };
  if (e.image) {
    const { width, height } = readImageSize(path.join(ASSETS, "events", e.image));
    out.imageWidth = width;
    out.imageHeight = height;
  }
  return out;
});
const SC = C.shoppingCenterJsonLd(site);

// ---- 共通パーツ ----
function lineCta() {
  return `<div class="cta"><a class="line-btn" href="${esc(site.lineUrl)}" target="_blank" rel="noopener">公式LINEでつながる</a></div>`;
}

// 「活動の手引き」分割画像（assets/guidelines/）。
// 注: alt/説明は「手引きの引用」なので実物の冊子どおり（08は漢字「歩いてみよう・覗いてみよう」）。
//     ※サイト内テキスト（バッジ等）は data/site.json 側でひらがなに統一（オーナー裁定）。
const GUIDELINES = {
  "01.jpg": { caption: "表紙", alt: "活動の手引き 表紙「あづまテラス 活動の手引」とロゴ" },
  "02.jpg": { caption: "はじめに", alt: "はじめに：「東あづま本通り」は「あづまテラス」へ！" },
  "03.jpg": { caption: "ビジョン", alt: "ビジョン「心地いい」をともに創る" },
  "04.jpg": { caption: "どんぐりのエピソード", alt: "手書きエピソード：ベンチで子どもからどんぐりを手渡された朝の話" },
  "05.jpg": { caption: "メロンパンのエピソード", alt: "手書きエピソード：パン屋でのメロンパンを通じたささやかなつながり" },
  "06.jpg": { caption: "名前に込めた想い", alt: "名前に込めた想い：みんなが集い心地よさを感じられる空間へ" },
  "07.jpg": { caption: "ロゴマークの由来", alt: "ロゴマークの由来：「づ」をモチーフに、御神木クスノキの緑をイメージ" },
  "08.jpg": { caption: "目指す姿・行動指針", alt: "目指す姿と行動指針（歩いてみよう・覗いてみよう・きれいにしよう・ファンになろう）" },
  "09.jpg": { caption: "まちのイラストマップ", alt: "あづまテラス周辺のイラストマップ（東あずま駅〜小村井駅、吾嬬神社・香梅園）" },
};

// 冊子と同じ「見開き」構成（画像は組み替えのみ・加工なし）
const GUIDE_LAYOUT = [
  { type: "single", items: ["01.jpg"] },                 // 表紙
  { type: "single", items: ["03.jpg"] },                 // ビジョン
  { type: "spread", items: ["02.jpg", "06.jpg"] },       // はじめに / 名前に込めた想い
  { type: "spread", items: ["07.jpg", "08.jpg"] },       // ロゴマーク / 目指す姿・行動指針
  { type: "spread", items: ["05.jpg", "04.jpg"] },       // メロンパン / どんぐり
  { type: "full", items: ["09.jpg"] },                   // イラストマップ（全幅）
];

function guideImgTag(file) {
  const g = GUIDELINES[file];
  const wide = file === "09.jpg";
  return `<a class="pg" href="assets/guidelines/${file}" target="_blank" rel="noopener" title="タップで原寸表示（拡大可）">
      <img src="assets/guidelines/${file}" width="${wide ? 2104 : 1052}" height="1488" loading="lazy" alt="${esc(g.alt)}">
    </a>`;
}

function guidelineBook() {
  const rows = GUIDE_LAYOUT.map((row) => {
    if (row.type === "single") {
      const f = row.items[0];
      return `<figure class="guide-single">
    ${guideImgTag(f)}
    <figcaption>${esc(GUIDELINES[f].caption)}</figcaption>
  </figure>`;
    }
    if (row.type === "full") {
      const f = row.items[0];
      return `<figure class="guide-full">
    ${guideImgTag(f)}
    <figcaption>${esc(GUIDELINES[f].caption)}</figcaption>
  </figure>`;
    }
    // spread: 左右2枚を全幅で並置（縦積みにしない）
    const [l, r] = row.items;
    return `<figure class="guide-spread">
    <div class="pages">
      ${guideImgTag(l)}
      ${guideImgTag(r)}
    </div>
    <figcaption>${esc(GUIDELINES[l].caption)} ／ ${esc(GUIDELINES[r].caption)}</figcaption>
  </figure>`;
  }).join("\n  ");
  return `<div class="guide-book">
  ${rows}
</div>`;
}

function pickFeaturedEvents(all) {
  // 開催予定/開催中があれば dateStart 昇順（直近が先頭）。無ければ直近の過去1件。
  const active = all
    .filter((e) => e.status === "upcoming" || e.status === "ongoing")
    .slice()
    .sort((a, b) => (a.dateStart < b.dateStart ? -1 : a.dateStart > b.dateStart ? 1 : 0));
  if (active.length) return active;
  const past = all.filter((e) => e.status === "past").slice().sort((a, b) => (a.dateStart < b.dateStart ? 1 : -1));
  return past.slice(0, 1);
}

// ---- ページ生成 ----
function pageIndex() {
  const shopCount = shops.filter((s) => s.category === "shop").length;
  const medicalCount = shops.filter((s) => s.category === "medical").length;
  const featured = pickFeaturedEvents(events);
  const featuredHtml = featured
    .map((e) => `<div class="hero-event">${C.eventCard(e).replace(/^<article[^>]*>/, "").replace(/<\/article>$/, "")}</div>`)
    .join("\n");
  const content = `
<section class="hero">
  <img class="logo-mark" src="assets/logo-mark.svg" alt="${esc(site.alternateName)}（${esc(site.name)}）ロゴ" width="210" height="100">
  <h1>${esc(site.alternateName)}</h1>
  <p class="catch">${esc(site.vision)}</p>
  <p class="sub">${esc(site.access)}</p>
  <p><a class="line-btn" href="${esc(site.lineUrl)}" target="_blank" rel="noopener">公式LINEでつながる</a></p>
</section>

<section class="block"><div class="container">
  <div class="section-head"><h2>いまのイベント</h2><span class="en">EVENT</span></div>
  ${featuredHtml}
  <p style="text-align:center;margin-top:14px"><a href="events.html">イベント一覧を見る →</a></p>
</div></section>

<section class="block"><div class="container">
  <div class="section-head"><h2>あづまテラスを歩く</h2><span class="en">GUIDE</span></div>
  <div class="links-row">
    <a class="link-tile" href="shops.html"><span class="em">🍜</span>店舗一覧<br><small>お店${shopCount}店</small></a>
    <a class="link-tile" href="medical.html"><span class="em">🩺</span>医療・健康<br><small>${medicalCount}件</small></a>
    <a class="link-tile" href="access.html"><span class="em">🚉</span>アクセス<br><small>東あずま駅1分</small></a>
    <a class="link-tile" href="about.html"><span class="em">🏮</span>商店街について<br><small>由来・指針</small></a>
  </div>
</div></section>

<section class="block"><div class="container">
  <div class="section-head"><h2>わたしたちの行動指針</h2><span class="en">ACTION</span></div>
  <ul class="guidelines">${site.guidelines.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>
</div></section>
`;
  return layout(
    { title: "", description: `${site.name}（あづまテラス）公式サイト。${site.access}。${site.vision}。`, active: "index.html", jsonld: [SC], content },
    site
  );
}

function pageEvents() {
  // 表示順は build.js が機械的にソートする（events.json の記載順に意味を持たせない・オーナー裁定）
  //  開催予定/開催中: dateStart 昇順（近い日付が上） ／ 過去: dateStart 降順（新しいものが上）
  const upcoming = events
    .filter((e) => e.status === "upcoming" || e.status === "ongoing")
    .slice()
    .sort((a, b) => (a.dateStart < b.dateStart ? -1 : a.dateStart > b.dateStart ? 1 : 0));
  const past = events
    .filter((e) => e.status === "past")
    .slice()
    .sort((a, b) => (a.dateStart < b.dateStart ? 1 : a.dateStart > b.dateStart ? -1 : 0));
  const upHtml = upcoming.length
    ? `<div class="grid">${upcoming.map(C.eventCard).join("\n")}</div>`
    : `<p class="lead">現在、開催予定・開催中のイベントはありません。これまでの開催をご覧ください。</p>`;
  const pastHtml = past.length ? `<div class="grid">${past.map(C.eventCard).join("\n")}</div>` : "";
  const content = `
<section class="block"><div class="container">
  <div class="section-head"><h2>イベント</h2><span class="en">EVENTS</span></div>
  <div class="section-head"><h2 style="font-size:1.05rem">開催予定・開催中</h2></div>
  ${upHtml}
  <div class="section-head" style="margin-top:24px"><h2 style="font-size:1.05rem">これまでの開催</h2></div>
  ${pastHtml}
</div></section>
${lineCta()}
`;
  const jsonld = [SC, ...events.map((e) => C.eventJsonLd(e, site))];
  // meta description はビルド時に生成する（終了済みのイベント名を固定文言で残さない・ops_orders id=22）。
  //  開催予定/開催中があればその名前と日付を、無ければ日付に依存しない汎用文を使う。
  const fmtWhen = (e) => (e.dateStart === e.dateEnd ? C.fmtDate(e.dateStart) : `${C.fmtDate(e.dateStart)}〜${C.fmtDate(e.dateEnd)}`);
  const description = upcoming.length
    ? `${site.name}（${site.alternateName}）のイベント情報。開催予定：${upcoming.map((e) => `${e.title}（${fmtWhen(e)}）`).join("、")}。これまでに開催したイベントもご覧いただけます。`
    : `${site.name}（${site.alternateName}）のイベント・お知らせ一覧。これまでに開催したイベントもご覧いただけます。`;
  return layout({ title: "イベント", description, active: "events.html", jsonld, content }, site);
}

// イベントの参加店一覧ページ（/<slug>）。data/campaigns.json から自動生成（ナビには入れない＝期間限定ページ）。
function pageCampaign(c) {
  const ev = events.find((e) => e.id === c.eventId);
  const BASE = "https://www.azuma-terrace.com";
  const WD = ["日", "月", "火", "水", "木", "金", "土"];
  const dayOf = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  };
  const when = ev ? `${C.fmtDate(ev.dateStart)}（${dayOf(ev.dateStart)}）${ev.timeNote ? " " + ev.timeNote : ""}` : "";
  const ended = c.ended
    ? `<p class="camp-ended">このイベントは終了しました（${esc(C.fmtDate(c.period.end))}開催）。</p>`
    : "";
  // デジタル商品券の利用期間（日付・時刻は campaigns.json の voucherFrom / voucherUntil から組み立てる。固定文言に書かない）
  const md = (iso) => { const [, m, d] = iso.slice(0, 10).split("-").map(Number); return { m, d }; };
  let voucherPeriod = "", voucherNote = "";
  if (c.voucherFrom && c.voucherUntil) {
    const f = md(c.voucherFrom), u = md(c.voucherUntil);
    const fromTime = c.voucherFrom.length > 10 ? c.voucherFrom.slice(11, 16) : "";
    const fromDay = c.voucherFrom.slice(0, 10), untilDay = c.voucherUntil;
    if (c.voucherEnded) {
      voucherPeriod = `<p class="camp-voucher ended">デジタル商品券の利用期間は終了しました（〜${esc(C.fmtDate(untilDay))}）</p>`;
      voucherNote = `<p class="camp-note">※デジタル商品券の利用期間は終了しました（〜${esc(C.fmtDate(untilDay))}）</p>`;
    } else {
      voucherPeriod = `<p class="camp-voucher">商品券の利用期間：<b>${f.m}/${f.d}${fromTime ? " " + esc(fromTime) : ""}〜${u.m}/${u.d}</b></p>`;
      voucherNote = `<p class="camp-note">※デジタル商品券はガラポン抽選の景品です。${f.m}月${f.d}日（${dayOf(fromDay)}）${fromTime ? esc(fromTime) : ""}から${u.m}月${u.d}日（${dayOf(untilDay)}）まで、上記の取扱店でご利用いただけます（当日の会場ではご利用いただけません）</p>`;
    }
  }
  const mark = (on, label) => `<span class="camp-mark ${on ? "on" : "off"}">${esc(label)}<b>${on ? "○" : "—"}</b><span class="sr">${on ? "対象" : "対象外"}</span></span>`;
  const cards = c.entries.map(({ shop: s, stampRally, voucher, isNew }) => {
    const href = `${s.category === "medical" ? "medical" : "shops"}.html#${s.id}`;
    const rows = [`<p class="meta"><span class="k">住所</span><span>${esc(s.address)}</span></p>`];
    if (s.tel) rows.push(`<p class="meta"><span class="k">電話</span>${C.telLink(s.tel)}</p>`);
    return `<article class="card camp-card">
  <span class="genre">${esc(s.genre)}</span>${isNew ? ` <span class="camp-new">NEW</span>` : ""}
  <h3><a href="${esc(href)}">${esc(s.name)}</a></h3>
  <p class="camp-marks">${mark(stampRally, "スタンプラリー")}${mark(voucher, "デジタル商品券")}</p>
  ${rows.join("\n  ")}
</article>`;
  }).join("\n");
  const content = `
<section class="block"><div class="container">
  <div class="section-head"><h2>${esc(c.title)}</h2><span class="en">STAMP RALLY</span></div>
  ${ended}
  ${ev ? `<p class="lead">${esc(ev.title)}<br>開催日：${esc(when)}<br>会場：${esc(ev.venue)}<br><a href="events.html#${esc(ev.id)}">イベントの詳細を見る →</a></p>` : ""}
  <div class="camp-stats">
    <div class="camp-stat"><b>${c.counts.stampRally}</b><span>スタンプラリー参加店</span></div>
    <div class="camp-stat"><b>${c.counts.voucher}</b><span>デジタル商品券取扱店</span></div>
    <div class="camp-stat"><b>${c.counts.isNew}</b><span>新規参加店</span></div>
  </div>
  ${voucherPeriod}
  <p class="camp-legend">○＝対象　—＝対象外　<span class="camp-new">NEW</span>＝今回から参加</p>
  <div class="grid">${cards}</div>
  ${voucherNote}
  ${(c.notes || []).map((n) => `<p class="camp-note">※${esc(n)}</p>`).join("\n  ")}
</div></section>
${lineCta()}
`;
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: c.title,
    numberOfItems: c.entries.length,
    itemListElement: c.entries.map(({ shop: s }, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: s.name,
      url: `${BASE}/${s.category === "medical" ? "medical" : "shops"}#${s.id}`,
    })),
  };
  const description = `${c.title}。スタンプラリー参加店${c.counts.stampRally}店・デジタル商品券取扱店${c.counts.voucher}店（うち新規参加${c.counts.isNew}店）の一覧です。`;
  return layout({ title: c.title, description, active: c.page, ogImage: "og-events.jpg", jsonld: [SC, itemList], content }, site);
}

// 企業・団体向け「協賛・PRブースのご案内」（/sponsor・2026-10-10 オーナー指示・ops_orders id=30）。
// 年間イベントは events.json の series ごとに自動生成（時期は開催実績の月から算出・固定で書かない）。
// 実績数字は site.json の highlights（オーナー提供の一次情報とサイト自前の計測値のみ）から文面を組み立てる。
function pageSponsor() {
  const BASE = "https://www.azuma-terrace.com";
  const nf = (n) => Number(n).toLocaleString("ja-JP");
  const evById = (id) => events.find((e) => e.id === id);

  // ---- 実績（ハイライト帯）----
  const H = site.highlights || {};
  const tiles = [];
  if (H.lineFriends) {
    const [y, m] = String(H.lineFriends.asOf || "").split("-").map(Number);
    tiles.push({ value: `${nf(H.lineFriends.count)}人${H.lineFriends.over ? "超" : ""}`, label: "公式LINE 友だち", note: y && m ? `${y}年${m}月時点` : "" });
  }
  if (H.cornSoldOut) {
    const ev = evById(H.cornSoldOut.eventId);
    tiles.push({ value: `${nf(H.cornSoldOut.count)}本`, label: `とうもろこしが約${H.cornSoldOut.hours}時間で完売`, note: ev ? ev.title.replace(/^あづまテラス\s*/, "") : "" });
  }
  if (H.siteVisitors) {
    const ev = evById(H.siteVisitors.eventId);
    const evName = ev ? ev.title.replace(/^あづまテラス\s*/, "") : "まつり";
    tiles.push({ value: `約${nf(H.siteVisitors.approx)}人`, label: `公式サイト訪問（${evName}期間の約${H.siteVisitors.periodWeeks}週間）`, note: `自前計測（${H.siteVisitors.source}・実測${nf(H.siteVisitors.measured)}人）` });
  }
  const highlightsHtml = tiles.length
    ? `<div class="sp-stats">${tiles.map((t) => `<div class="sp-stat"><b>${esc(t.value)}</b><span>${esc(t.label)}</span>${t.note ? `<small>${esc(t.note)}</small>` : ""}</div>`).join("")}</div>`
    : "";

  // ---- 年間イベント（events.json の series ごと）----
  const seriesMap = new Map();
  for (const e of events) {
    const key = e.series || e.title;
    if (!seriesMap.has(key)) seriesMap.set(key, []);
    seriesMap.get(key).push(e);
  }
  const monthsOf = (e) => {
    const out = [];
    const [y1, m1] = e.dateStart.split("-").map(Number);
    const [y2, m2] = (e.dateEnd || e.dateStart).split("-").map(Number);
    for (let y = y1, m = m1; y < y2 || (y === y2 && m <= m2); m === 12 ? (y++, (m = 1)) : m++) out.push(m);
    return out;
  };
  const series = [...seriesMap.entries()].map(([name, list]) => {
    const months = [...new Set(list.flatMap(monthsOf))].sort((a, b) => a - b);
    const latest = list.slice().sort((a, b) => (a.dateStart < b.dateStart ? 1 : -1))[0];
    const withImage = list.filter((e) => e.image).sort((a, b) => (a.dateStart < b.dateStart ? 1 : -1))[0];
    const years = [...new Set(list.map((e) => Number(e.dateStart.slice(0, 4))))].sort((a, b) => a - b);
    const first = String(latest.summary || "").split("。")[0];
    return {
      name, months, latest, withImage, years,
      when: months.length > 1 && months[months.length - 1] - months[0] === months.length - 1 ? `${months[0]}〜${months[months.length - 1]}月` : `${months.join("・")}月`,
      gist: first.length > 70 ? first.slice(0, 70) + "…" : first,
    };
  }).sort((a, b) => a.months[0] - b.months[0]);
  const seriesHtml = series.map((s) => {
    const img = s.withImage
      ? `<a class="sp-flyer" href="assets/events/${esc(s.withImage.image)}" target="_blank" rel="noopener" title="チラシを原寸で開く"><img src="assets/events/${esc(s.withImage.image)}" width="${Number(s.withImage.imageWidth)}" height="${Number(s.withImage.imageHeight)}" loading="lazy" alt="${esc(s.withImage.title)}のチラシ"></a>`
      : "";
    return `<article class="card sp-series">
  <span class="genre">開催時期：${esc(s.when)}</span>
  <h3>${esc(s.name)}</h3>
  <p class="meta"><span>${esc(s.gist)}</span></p>
  <p class="meta"><span class="k">開催実績</span><span>${s.years.map((y) => `${y}年`).join("・")}</span></p>
  <p class="meta"><span class="k">直近</span><span><a href="events.html#${esc(s.latest.id)}">${esc(s.latest.title)}</a>（${esc(C.fmtDate(s.latest.dateStart))}）</span></p>${img ? "\n  " + img : ""}
</article>`;
  }).join("\n");

  // ---- お問い合わせ（公式LINEが主・メールが副）----
  const subject = "【協賛・ブースのご相談】";
  const bodyTpl = "団体名：\nご連絡先：\nご希望のイベント：\n企画の概要：\n";
  const mailto = `mailto:${site.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyTpl)}`;

  const content = `
<section class="block"><div class="container">
  <div class="section-head"><h2>協賛・PRブースのご案内</h2><span class="en">SPONSOR</span></div>
  <p class="lead">あづまテラス（${esc(site.name)}）のイベントは、地域の企業・団体の皆さまに「商店街に集まる人たちへ直接届ける機会」として開かれています。新製品のお披露目・サンプリング・体験ブースなど、地域と一緒に楽しめる企画を歓迎します。地域と一緒に盛り上げませんか。</p>
  ${highlightsHtml}
  <div class="section-head" style="margin-top:24px"><h2 style="font-size:1.05rem">年間イベント</h2></div>
  <div class="grid">${seriesHtml}</div>
  <div class="section-head" style="margin-top:24px"><h2 style="font-size:1.05rem">ご一緒いただける形（例）</h2></div>
  <ul class="sp-list">
    <li><b>協賛</b>（冠協賛・景品のご提供）</li>
    <li><b>製品サンプリング</b>（例：とうもろこしまつりでのとうもろこし関連商品の配布・試食）</li>
    <li><b>PRブース・体験コーナー</b>（ワークショップなど）</li>
    <li><b>新商品のお披露目</b>（キッチンカーなど）</li>
    <li><b>地域団体・学校の参加</b>（ステージ参加など）</li>
  </ul>
  <p>上記以外のご提案もお気軽にご相談ください。</p>
  <div class="section-head" style="margin-top:24px"><h2 style="font-size:1.05rem">ご相談の流れ</h2></div>
  <ol class="sp-flow">
    <li>ご相談（公式LINE、またはメール）</li>
    <li>打ち合わせ（内容・時期・場所のすり合わせ）</li>
    <li>当日</li>
  </ol>
  <p>所要時間・費用などは、企画の内容によりご相談のうえで決めています。</p>
  <div class="section-head" style="margin-top:24px"><h2 style="font-size:1.05rem">お問い合わせ</h2></div>
  <p>お問い合わせは<b>公式LINE</b>からお気軽にどうぞ。</p>
  ${lineCta()}
  <p class="sp-mail">メールでのご相談は <a href="${esc(mailto)}">${esc(site.email)}</a> まで（件名「${esc(subject)}」と記入例が入った状態で開きます）。</p>
</div></section>
`;
  const org = {
    "@type": "Organization",
    name: site.name,
    alternateName: site.alternateName,
    url: `${BASE}/`,
    email: site.email,
    contactPoint: { "@type": "ContactPoint", contactType: "sponsorship", email: site.email, url: site.lineUrl, availableLanguage: "ja" },
  };
  const webPage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "協賛・PRブースのご案内",
    url: `${BASE}/sponsor`,
    description: "地域の企業・団体向けに、あづまテラスのイベントでの協賛・PRブース・サンプリングをご案内するページです。",
    publisher: org,
    about: org,
  };
  const description = `地域の企業・団体向けの協賛・PRブースのご案内。あづまテラス（${site.name}）の年間イベント（${series.map((s) => s.name).join("・")}）で、協賛・製品サンプリング・PRブース・新商品のお披露目をご相談いただけます。`;
  return layout({ title: "協賛・PRブースのご案内", description, active: "sponsor.html", jsonld: [SC, webPage], content }, site);
}

function groupedShops(list, groupFn, groups) {
  return groups
    .map(({ key, title, cls }) => {
      const items = list.filter((s) => groupFn(s.genre) === key);
      if (!items.length) return "";
      return `<div class="cat-group ${cls}">
  <h3 class="cat-title">${esc(title)}</h3>
  <div class="grid">${items.map(C.shopCard).join("\n")}</div>
</div>`;
    })
    .join("\n");
}

function pageShops() {
  const shopList = shops.filter((s) => s.category === "shop");
  const grouped = groupedShops(shopList, C.shopGroup, [
    { key: "eat", title: "食べる", cls: "eat" },
    { key: "buy", title: "買う", cls: "buy" },
    { key: "service", title: "暮らしのサービス", cls: "service" },
  ]);
  const content = `
<section class="block"><div class="container">
  <div class="section-head"><h2>店舗一覧</h2><span class="en">SHOPS</span></div>
  <p class="lead">あづまテラス（${esc(site.name)}）の一般店舗 ${shopList.length} 店をジャンル別にご紹介します。</p>
  ${grouped}
</div></section>
${lineCta()}
`;
  const jsonld = [SC, ...shopList.map((s) => C.shopJsonLd(s, site))];
  return layout({ title: "店舗一覧", description: `あづまテラス（${site.name}）の一般店舗${shopList.length}店。飲食・買い物・暮らしのサービスをジャンル別に紹介。`, active: "shops.html", jsonld, content }, site);
}

function pageMedical() {
  const list = shops.filter((s) => s.category === "medical");
  const grouped = groupedShops(list, C.medicalGroup, [
    { key: "clinic", title: "診療（歯科・医院・整骨院など）", cls: "" },
    { key: "pharmacy", title: "薬局", cls: "pharmacy" },
    { key: "care", title: "介護・福祉", cls: "care" },
  ]);
  const content = `
<section class="block"><div class="container">
  <div class="section-head"><h2>医療・健康</h2><span class="en">MEDICAL</span></div>
  <p class="lead">あづまテラス周辺の医療・健康に関わる ${list.length} 件をご紹介します。</p>
  ${grouped}
</div></section>
${lineCta()}
`;
  const jsonld = [SC, ...list.map((s) => C.shopJsonLd(s, site))];
  return layout({ title: "医療・健康", description: `あづまテラス（${site.name}）周辺の医療・健康・介護福祉施設${list.length}件。歯科・医院・整骨院・薬局・介護福祉施設を紹介。`, active: "medical.html", jsonld, content }, site);
}

function pageAccess() {
  // 地図ピン・geo＝来街者の目的地（商店街中心・ダイエー前）。会の所在地(address)とは役割が異なる（一致させない）。
  const lat = site.geo.lat, lng = site.geo.lng;
  const gmap = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const osm = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
  // 商店街と東あずま駅が両方見える程度のbbox（中心=ピン座標、マーカー付き）
  const dLat = 0.0045, dLng = 0.007;
  const bbox = [(lng - dLng).toFixed(5), (lat - dLat).toFixed(5), (lng + dLng).toFixed(5), (lat + dLat).toFixed(5)].join("%2C");
  const osmEmbed = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
  const nearby = site.nearby.map((n) => `<li><strong>${esc(n.name)}</strong>：${esc(n.note)}</li>`).join("");
  const content = `
<section class="block"><div class="container">
  <div class="section-head"><h2>アクセス</h2><span class="en">ACCESS</span></div>
  <div class="card info">
    <dl>
      <dt>所在地</dt><dd>${esc(site.addressFull)}</dd>
      <dt>エリア</dt><dd>商店街のエリアは${esc(site.area)}に広がります</dd>
      <dt>最寄駅</dt><dd>${esc(site.access)}</dd>
    </dl>
  </div>
  <div class="map-links">
    <a href="${esc(gmap)}" target="_blank" rel="noopener">Googleマップで開く</a>
    <a href="${esc(osm)}" target="_blank" rel="noopener">OpenStreetMapで開く</a>
  </div>
  <iframe class="map-embed" src="${esc(osmEmbed)}" title="あづまテラス 周辺地図（OpenStreetMap）" loading="lazy"></iframe>
  <p class="lead" style="margin-top:12px">地図のピンは商店街の中心（ダイエー前）です。イベントは主に東あずま駅前（ダイエー前）周辺で開催します。</p>
</div></section>

<section class="block"><div class="container">
  <div class="section-head"><h2>まちの見どころ</h2><span class="en">AROUND</span></div>
  <ul class="lead">${nearby}</ul>
</div></section>
${lineCta()}
`;
  return layout({ title: "アクセス", description: `あづまテラス（${site.name}）へのアクセス。${site.access}。周辺には吾嬬神社・香梅園。`, active: "access.html", jsonld: [SC], content }, site);
}

function pageAbout() {
  const content = `
<section class="block"><div class="container">
  <div class="section-head"><h2>商店街について</h2><span class="en">ABOUT</span></div>

  <div class="section-head" style="margin-top:8px"><h2 style="font-size:1.05rem">ビジョン</h2></div>
  <p class="catch" style="font-size:1.25rem;color:var(--green-dark)">${esc(site.vision)}</p>

  <div class="section-head" style="margin-top:16px"><h2 style="font-size:1.05rem">行動指針</h2></div>
  <ul class="guidelines">${site.guidelines.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>
  <p><a href="guidelines.html">私たちの行動指針（活動の手引き）を見る →</a></p>

  <div class="section-head" style="margin-top:16px"><h2 style="font-size:1.05rem">名前の由来</h2></div>
  <p>${esc(site.origin)}</p>

  <div class="section-head" style="margin-top:16px"><h2 style="font-size:1.05rem">基本情報</h2></div>
  <div class="card info">
    <dl>
      <dt>名称</dt><dd>${esc(site.name)}</dd>
      <dt>愛称</dt><dd>${esc(site.alternateName)}（${esc(site.alternateNameEn)}）</dd>
      <dt>所在地</dt><dd>${esc(site.addressFull)}</dd>
      <dt>アクセス</dt><dd>${esc(site.access)}</dd>
    </dl>
  </div>

  <div class="section-head" style="margin-top:16px"><h2 style="font-size:1.05rem">お問い合わせ</h2></div>
  <p>お問い合わせは公式LINE、またはメール <a href="mailto:${esc(site.email)}">${esc(site.email)}</a> よりお気軽にどうぞ。</p>
  <p>企業・団体の皆さまの協賛・PRブース・サンプリングのご相談は、<a href="sponsor.html">協賛・PRブースのご案内</a>をご覧ください。</p>
  ${lineCta()}
</div></section>
`;
  return layout({ title: "商店街について", description: `${site.name}（あづまテラス）について。ビジョン「${site.vision}」、行動指針、名前の由来、公式LINE・メール。`, active: "about.html", jsonld: [SC], content }, site);
}

function pageGuidelines() {
  const content = `
<section class="block"><div class="container">
  <div class="section-head"><h2>私たちの行動指針</h2><span class="en">GUIDELINES</span></div>
  <p class="lead">あづまテラス（${esc(site.name)}）が大切にしている想いをまとめた「活動の手引き」です。表紙から順にご覧ください。各ページをタップすると原寸で開きます。</p>

  ${guidelineBook()}

  <div class="card info" style="margin-top:20px">
    <div class="section-head" style="margin-top:0"><h2 style="font-size:1.05rem">ビジョン</h2></div>
    <p class="catch" style="font-size:1.2rem;color:var(--green-dark);margin:0 0 14px">${esc(site.vision)}</p>
    <div class="section-head"><h2 style="font-size:1.05rem">行動指針</h2></div>
    <ul class="guidelines" style="margin-top:6px">
      <li>あるいてみよう</li>
      <li>のぞいてみよう</li>
      <li>きれいにしよう</li>
      <li>ファンになろう</li>
    </ul>
  </div>
</div></section>
${lineCta()}
`;
  return layout({
    title: "行動指針",
    description: `${site.name}（あづまテラス）の活動の手引き。ビジョン「${site.vision}」と行動指針（あるいてみよう・のぞいてみよう・きれいにしよう・ファンになろう）、名前の由来やまちのイラストマップを掲載。`,
    active: "guidelines.html",
    jsonld: [SC],
    content,
  }, site);
}

// ---- 実行 ----
function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const pages = {
    "index.html": pageIndex(),
    "events.html": pageEvents(),
    "shops.html": pageShops(),
    "medical.html": pageMedical(),
    "access.html": pageAccess(),
    "guidelines.html": pageGuidelines(),
    "sponsor.html": pageSponsor(),
    "about.html": pageAbout(),
  };
  for (const c of campaigns) pages[c.page] = pageCampaign(c);
  for (const [name, html] of Object.entries(pages)) {
    fs.writeFileSync(path.join(DIST, name), html, "utf8");
  }

  // 共通CSS
  fs.copyFileSync(path.join(ROOT, "templates", "styles.css"), path.join(DIST, "styles.css"));
  // アセット（ロゴ等）
  const n = copyDir(ASSETS, path.join(DIST, "assets"));
  // favicon / apple-touch-icon は dist 直下に配置（生成元は assets/、make-og.mjs で生成）
  for (const f of ["favicon.ico", "apple-touch-icon.png"]) {
    const src = path.join(ASSETS, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DIST, f));
  }

  console.log(`✓ built ${Object.keys(pages).length} pages -> dist/`);
  console.log(`✓ copied ${n} asset file(s), styles.css`);
  console.log("  pages: " + Object.keys(pages).join(", "));
  console.log(`  events: ビルド日(JST) ${BUILD_DATE_JST} で判定 → ` + events.map((e) => `${e.id}=${e.status}`).join(", "));
}

build();
