"use strict";
// 共通レイアウト（ヘッダー・フッター・<head>）。build.js から呼ばれる。

const NAV = [
  { href: "index.html", label: "ホーム" },
  { href: "events.html", label: "イベント" },
  { href: "shops.html", label: "店舗一覧" },
  { href: "medical.html", label: "医療・健康" },
  { href: "access.html", label: "アクセス" },
  { href: "guidelines.html", label: "行動指針" },
  { href: "about.html", label: "商店街について" },
];

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function header(active, site) {
  const items = NAV.map(
    (n) =>
      `<li><a href="${n.href}"${n.href === active ? ' aria-current="page"' : ""}>${esc(n.label)}</a></li>`
  ).join("");
  return `<header class="site-header">
  <div class="bar">
    <a class="brand" href="index.html">
      <img src="assets/logo-type-ja.svg" alt="${esc(site.alternateName)}（${esc(site.name)}）" height="26">
    </a>
    <button class="nav-toggle" aria-expanded="false" aria-controls="site-nav" onclick="var n=document.getElementById('site-nav');var o=n.classList.toggle('open');this.setAttribute('aria-expanded',o);">メニュー</button>
  </div>
  <nav class="site-nav" id="site-nav" aria-label="メインメニュー"><ul>${items}</ul></nav>
</header>`;
}

function footer(site) {
  const fnav = NAV.map((n) => `<li><a href="${n.href}">${esc(n.label)}</a></li>`).join("");
  return `<footer class="site-footer">
  <div class="container">
    <ul class="fnav">${fnav}</ul>
    <p><a class="line-btn" href="${esc(site.lineUrl)}" target="_blank" rel="noopener">公式LINEでつながる</a></p>
    <p class="copyright">${esc(site.name)}（あづまテラス）／${esc(site.addressFull)}<br>お問い合わせ：公式LINE または <a href="mailto:${esc(site.email)}">${esc(site.email)}</a><br>© ${esc(site.name)}</p>
  </div>
</footer>`;
}

// page: { title, description, active, jsonld:[...], content }
function layout(page, site) {
  const jsonld = (page.jsonld || [])
    .filter(Boolean)
    .map(
      (obj) =>
        `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`
    )
    .join("\n");
  const title = page.title
    ? `${page.title}｜${site.alternateName}（${site.name}）`
    : `${site.alternateName}（${site.name}）`;
  const BASE = "https://www.azuma-terrace.com";
  const active = page.active || "index.html";
  const canonical = active === "index.html" ? `${BASE}/` : `${BASE}/${active.replace(/\.html$/, "")}`;
  const ogImage = `${BASE}/assets/og/${active === "events.html" ? "og-events.jpg" : "og-default.jpg"}`;
  const siteName = `${site.alternateName}（${site.name}）`;
  const desc = page.description || "";
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" href="favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="ja_JP">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="${esc(siteName)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@400;500;700;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css">
${jsonld}
<script>
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
</script>
<script defer src="/_vercel/insights/script.js"></script>
</head>
<body>
${header(page.active, site)}
<main>
${page.content}
</main>
${footer(site)}
</body>
</html>`;
}

module.exports = { layout, esc, NAV };
