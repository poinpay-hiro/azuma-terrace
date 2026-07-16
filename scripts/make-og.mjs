// OGP画像・favicon 生成（定型・固定処理）。ローカル処理のみ・ネットワーク接続なし・コマンドライン引数なし。
// 生成物（assets/ に出力。build.js が dist へ配置）:
//   assets/og/og-default.jpg   1200x630  … ベージュ地＋ロゴ（ロックアップ）＋下部テキスト
//   assets/og/og-events.jpg    1200x630  … とうもろこしまつり2026チラシをレターボックス配置（無加工）
//   assets/favicon.ico         32x32     … ロゴマークのシンボル部分（右クラスタ）
//   assets/apple-touch-icon.png 180x180  … 同シンボル・ベージュ地
// 注: ロゴは変形・色変更・装飾付加を行わない（トリミング＝シンボル部分の抽出とレターボックスのみ）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = path.join(ROOT, "assets");
const OG_DIR = path.join(ASSETS, "og");
const BEIGE = "#fbf7f0";
const INK = "#3a3a34";

// 日本語フォント登録（macOS。存在する最初のものを使う）
const JP_FONTS = [
  "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
  "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
  "/Library/Fonts/Arial Unicode.ttf",
];
let JP = "sans-serif";
for (const f of JP_FONTS) { if (fs.existsSync(f)) { try { GlobalFonts.registerFromPath(f, "JP"); JP = "JP"; break; } catch {} } }

// svg: 名前空間prefixを除去して resvg(canvas) で読めるようにする
async function loadCleanSvg(file) {
  const s = fs.readFileSync(path.join(ASSETS, file), "utf8").replace(/svg:/g, "");
  return loadImage(Buffer.from(s, "utf8"));
}
function encodeJpegUnder(canvas, targetBytes = 200 * 1024, startQ = 88, minQ = 60) {
  let q = startQ, buf = canvas.encodeSync("jpeg", q);
  while (buf.length > targetBytes && q > minQ) { q -= 4; buf = canvas.encodeSync("jpeg", q); }
  return { buf, q };
}

async function makeOgDefault() {
  const W = 1200, H = 630;
  const cv = createCanvas(W, H); const c = cv.getContext("2d");
  c.fillStyle = BEIGE; c.fillRect(0, 0, W, H);
  const logo = await loadCleanSvg("logo-mark.svg"); // ロックアップ（2.112:1）
  const lw = 640, lh = lw * logo.height / logo.width; // アスペクト維持
  c.drawImage(logo, (W - lw) / 2, (H - lh) / 2 - 34, lw, lh);
  c.fillStyle = INK; c.font = `500 34px ${JP}`; c.textAlign = "center"; c.textBaseline = "alphabetic";
  c.fillText("東あづま本通り会（東京都墨田区立花）", W / 2, H - 66);
  const { buf, q } = encodeJpegUnder(cv);
  fs.writeFileSync(path.join(OG_DIR, "og-default.jpg"), buf);
  return { name: "og-default.jpg", w: W, h: H, q, bytes: buf.length };
}

async function makeOgEvents() {
  const W = 1200, H = 630;
  const cv = createCanvas(W, H); const c = cv.getContext("2d");
  c.fillStyle = BEIGE; c.fillRect(0, 0, W, H);
  const flyer = await loadImage(path.join(ASSETS, "events", "corn2026.jpg")); // 縦長ポスター
  const targetH = 606; // 上下に少し余白
  const dh = targetH, dw = dh * flyer.width / flyer.height; // アスペクト維持（レターボックス）
  c.drawImage(flyer, (W - dw) / 2, (H - dh) / 2, dw, dh);
  const { buf, q } = encodeJpegUnder(cv);
  fs.writeFileSync(path.join(OG_DIR, "og-events.jpg"), buf);
  return { name: "og-events.jpg", w: W, h: H, q, bytes: buf.length };
}

// ロゴマークの「シンボル部分」（右クラスタ: 緑の角＋縞円＋黄円）を正方形に描く
async function drawSymbolSquare(c, size, pad) {
  const logo = await loadCleanSvg("logo-mark.svg"); // native 585x277
  const sx = 320, sy = 0, sw = logo.width - 320, sh = logo.height; // 右クラスタ（wordmark除外）
  const box = size - 2 * pad;
  const r = sw / sh; // 抽出領域のアスペクト
  let dw = box, dh = box;
  if (r > 1) dh = box / r; else dw = box * r; // アスペクト維持で正方形内に収める（引き伸ばし禁止）
  c.drawImage(logo, sx, sy, sw, sh, (size - dw) / 2, (size - dh) / 2, dw, dh);
}

async function makeAppleTouch() {
  const S = 180;
  const cv = createCanvas(S, S); const c = cv.getContext("2d");
  c.fillStyle = BEIGE; c.fillRect(0, 0, S, S);
  await drawSymbolSquare(c, S, 22);
  const buf = cv.encodeSync("png");
  fs.writeFileSync(path.join(ASSETS, "apple-touch-icon.png"), buf);
  return { name: "apple-touch-icon.png", w: S, h: S, bytes: buf.length };
}

// 32x32 PNG を ICO コンテナに包む（Vista以降はPNG埋め込みICO可）
function pngToIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(32, 0); entry.writeUInt8(32, 1); entry.writeUInt8(0, 2); entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}
async function makeFavicon() {
  const S = 32;
  const cv = createCanvas(S, S); const c = cv.getContext("2d");
  c.fillStyle = BEIGE; c.fillRect(0, 0, S, S);
  await drawSymbolSquare(c, S, 2);
  const ico = pngToIco(cv.encodeSync("png"));
  fs.writeFileSync(path.join(ASSETS, "favicon.ico"), ico);
  return { name: "favicon.ico", w: S, h: S, bytes: ico.length };
}

(async () => {
  fs.mkdirSync(OG_DIR, { recursive: true });
  const out = [];
  out.push(await makeOgDefault());
  out.push(await makeOgEvents());
  out.push(await makeAppleTouch());
  out.push(await makeFavicon());
  for (const o of out) console.log(`OK ${o.name}  ${o.w}x${o.h}${o.q ? " q" + o.q : ""}  ${(o.bytes / 1024).toFixed(0)}KB`);
  console.log(`font: ${JP === "JP" ? "Hiragino(JP)" : "sans-serif(fallback)"}`);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
