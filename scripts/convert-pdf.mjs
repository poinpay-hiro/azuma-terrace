// PDF画像化（定型）。ローカルファイル操作のみ・ネットワーク接続なし。
// 使い方: node scripts/convert-pdf.mjs <入力PDF> <出力JPG> [幅px=1200] [ページ番号=1]
//   @napi-rs/canvas（プリビルド）＋ pdfjs のキャンバス描画方式。JPEG q85・目標500KB以下（超過時は自動で品質を段階的に下げる）。
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createCanvas } = require("@napi-rs/canvas");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

class NodeCanvasFactory {
  create(w, h) { const canvas = createCanvas(w, h); return { canvas, context: canvas.getContext("2d") }; }
  reset(cc, w, h) { cc.canvas.width = w; cc.canvas.height = h; }
  destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; }
}

const TARGET_BYTES = 500 * 1024; // 目標500KB以下
const START_QUALITY = 85;
const MIN_QUALITY = 60;

// PDF 1ページを JPEG 化して書き出す（バッファも返す）
export async function convertPdfPageToJpeg(pdfPath, outJpg, targetWidth = 1200, pageNo = 1) {
  const cf = new NodeCanvasFactory();
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data, canvasFactory: cf }).promise;
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const scale = targetWidth / base.width;
  const viewport = page.getViewport({ scale });
  const { canvas, context } = cf.create(Math.round(viewport.width), Math.round(viewport.height));
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, canvasFactory: cf }).promise;

  // 目標サイズに収まるまで品質を段階的に下げる
  let quality = START_QUALITY;
  let jpg = canvas.encodeSync("jpeg", quality);
  while (jpg.length > TARGET_BYTES && quality > MIN_QUALITY) {
    quality -= 5;
    jpg = canvas.encodeSync("jpeg", quality);
  }
  fs.writeFileSync(outJpg, jpg);
  return { width: canvas.width, height: canvas.height, quality, bytes: jpg.length };
}

// CLI 実行
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [pdfPath, outJpg, widthStr, pageStr] = process.argv.slice(2);
  if (!pdfPath || !outJpg) {
    console.error("使い方: node scripts/convert-pdf.mjs <入力PDF> <出力JPG> [幅px=1200] [ページ番号=1]");
    process.exit(2);
  }
  const width = Number(widthStr || 1200);
  const pageNo = Number(pageStr || 1);
  convertPdfPageToJpeg(pdfPath, outJpg, width, pageNo)
    .then((r) => {
      const kb = (r.bytes / 1024).toFixed(0);
      const warn = r.bytes > TARGET_BYTES ? `  ※500KB超（品質${r.quality}が下限）` : "";
      console.log(`OK: ${outJpg}  ${r.width}x${r.height}  q${r.quality}  ${kb}KB${warn}`);
    })
    .catch((e) => { console.error("ERR", e); process.exit(1); });
}
