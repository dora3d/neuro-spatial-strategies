const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const assetDir =
  'C:/Users/dominik/.cursor/projects/c-Users-dominik-Desktop-July-term-admin-space-collective-poster/assets';
const outDir = __dirname;

const files = [
  'network-variant-3people.png',
  'network-variant-6people.png',
  'network-variant-10people.png',
  'network-variant-15people.png',
];

// Marker for connector strokes (survives white flood-fill)
const MR = 255,
  MG = 0,
  MB = 255;

function isBg(r, g, b, a) {
  if (a < 8) return true;
  if (r === MR && g === MG && b === MB) return false;
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  return min > 228 && max - min < 22;
}

function isNearBlack(r, g, b) {
  return r < 75 && g < 75 && b < 75 && Math.max(r, g, b) - Math.min(r, g, b) < 30;
}

function isSaturatedColor(r, g, b) {
  if (r === MR && g === MG && b === MB) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min > 45 && max > 90;
}

function isMidGray(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min < 28 && min > 35 && max < 210;
}

async function processFile(name) {
  const srcPath = fs.existsSync(path.join(assetDir, name))
    ? path.join(assetDir, name)
    : path.join(outDir, name);
  if (!fs.existsSync(srcPath)) {
    console.log('skip missing', name);
    return;
  }

  const { data, info } = await sharp(srcPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const px = Buffer.from(data);

  // Pass A: mark black connector strokes as magenta BEFORE clearing white
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const o = (y * w + x) * 4;
      if (px[o + 3] < 8) continue;
      if (!isNearBlack(px[o], px[o + 1], px[o + 2])) continue;

      let colorN = 0,
        brightN = 0,
        grayN = 0,
        darkN = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!dx && !dy) continue;
          const no = ((y + dy) * w + (x + dx)) * 4;
          const r = px[no],
            g = px[no + 1],
            b = px[no + 2];
          if (px[no + 3] < 8 || isBg(r, g, b, px[no + 3])) brightN++;
          else if (isSaturatedColor(r, g, b)) colorN++;
          else if (isNearBlack(r, g, b)) darkN++;
          else if (isMidGray(r, g, b)) grayN++;
          else if (Math.min(r, g, b) > 200) brightN++;
        }
      }
      const looksLikeStroke = (brightN >= 4 || colorN >= 2) && grayN <= 9 && darkN <= 15;
      if (!looksLikeStroke) continue;
      if (grayN + darkN >= 17 && brightN < 4) continue;
      px[o] = MR;
      px[o + 1] = MG;
      px[o + 2] = MB;
      px[o + 3] = 255;
    }
  }

  // Pass B: flood-fill background from edges
  const visited = new Uint8Array(w * h);
  const qx = [];
  const qy = [];
  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (visited[i]) return;
    const o = i * 4;
    if (!isBg(px[o], px[o + 1], px[o + 2], px[o + 3])) return;
    visited[i] = 1;
    qx.push(x);
    qy.push(y);
  };
  for (let x = 0; x < w; x++) {
    enqueue(x, 0);
    enqueue(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    enqueue(0, y);
    enqueue(w - 1, y);
  }
  while (qx.length) {
    const x = qx.pop();
    const y = qy.pop();
    px[(y * w + x) * 4 + 3] = 0;
    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }

  // Clear leftover faint grid speckles
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (px[o + 3] < 8) continue;
    if (px[o] === MR && px[o + 1] === MG && px[o + 2] === MB) continue;
    if (!isBg(px[o], px[o + 1], px[o + 2], px[o + 3])) continue;
    const x = i % w;
    const y = (i / w) | 0;
    let bgN = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          bgN++;
          continue;
        }
        const no = (ny * w + nx) * 4;
        if (
          px[no + 3] < 8 ||
          isBg(px[no], px[no + 1], px[no + 2], px[no + 3])
        )
          bgN++;
      }
    }
    if (bgN >= 18) px[o + 3] = 0;
  }

  // Pass C: magenta markers → solid white lines
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (px[o + 3] < 8) continue;
    if (px[o] === MR && px[o + 1] === MG && px[o + 2] === MB) {
      px[o] = 255;
      px[o + 1] = 255;
      px[o + 2] = 255;
      px[o + 3] = 255;
    }
  }

  // Soften white cutout halos (near-white fringe on figure edges)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const o = (y * w + x) * 4;
      if (px[o + 3] < 8) continue;
      const r = px[o],
        g = px[o + 1],
        b = px[o + 2];
      const min = Math.min(r, g, b);
      const max = Math.max(r, g, b);
      if (!(min > 210 && max - min < 18)) continue;
      // if neighbor transparent and neighbor figure/color — fringe
      let clear = 0,
        content = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const no = ((y + dy) * w + (x + dx)) * 4;
          if (px[no + 3] < 8) clear++;
          else if (
            isSaturatedColor(px[no], px[no + 1], px[no + 2]) ||
            isMidGray(px[no], px[no + 1], px[no + 2]) ||
            isNearBlack(px[no], px[no + 1], px[no + 2])
          )
            content++;
        }
      }
      if (clear >= 2 && content >= 2) px[o + 3] = 0;
    }
  }

  const outPath = path.join(outDir, name);
  await sharp(px, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile(outPath);

  const previewPath = path.join(outDir, name.replace('.png', '-preview-dark.png'));
  await sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r: 28, g: 28, b: 34, alpha: 1 },
    },
  })
    .composite([{ input: outPath, blend: 'over' }])
    .png()
    .toFile(previewPath);

  console.log('ok', name);
}

(async () => {
  for (const f of files) await processFile(f);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
