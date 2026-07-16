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
const events = readJSON("events.json");
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
  return layout({ title: "イベント", description: `${site.name}のイベント情報。とうもろこしまつり2026（8月2日）や梅まつり・ハロウィンなど地域のイベントをお知らせします。`, active: "events.html", jsonld, content }, site);
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
  return layout({ title: "医療・健康", description: `あづまテラス（${site.name}）周辺の医療・健康施設${list.length}件。歯科・医院・整骨院・薬局を紹介。`, active: "medical.html", jsonld, content }, site);
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
    "about.html": pageAbout(),
  };
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
}

build();
