const sharp = require('sharp');
const path = require('path');

const SRC = path.join(__dirname, 'p3c.jpg');
const OUT = path.join(__dirname, 'network-stage3-regularized.png');

// Palette from brain network (pic 2)
const COLORS = ['#E53935', '#F9A825', '#43A047', '#1E88E5', '#1565C0', '#00897B', '#FB8C00', '#D81B60'];

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function delaunay(points) {
  const n = points.length;
  if (n < 3) return { edges: [], triangles: [] };

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dmax = Math.max(dx, dy) * 2;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  const pts = points
    .map((p, i) => ({ ...p, i }))
    .concat([
      { x: midX - 2 * dmax, y: midY - dmax, i: -1 },
      { x: midX, y: midY + 2 * dmax, i: -2 },
      { x: midX + 2 * dmax, y: midY - dmax, i: -3 },
    ]);
  let tris = [[n, n + 1, n + 2]];

  function circumcircle(a, b, c) {
    const A = pts[a],
      B = pts[b],
      C = pts[c];
    const d = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
    if (Math.abs(d) < 1e-10) return null;
    const ux =
      ((A.x * A.x + A.y * A.y) * (B.y - C.y) +
        (B.x * B.x + B.y * B.y) * (C.y - A.y) +
        (C.x * C.x + C.y * C.y) * (A.y - B.y)) /
      d;
    const uy =
      ((A.x * A.x + A.y * A.y) * (C.x - B.x) +
        (B.x * B.x + B.y * B.y) * (A.x - C.x) +
        (C.x * C.x + C.y * C.y) * (B.x - A.x)) /
      d;
    return { x: ux, y: uy, r: Math.hypot(A.x - ux, A.y - uy) };
  }

  for (let pi = 0; pi < n; pi++) {
    const p = pts[pi];
    const bad = [];
    for (let ti = 0; ti < tris.length; ti++) {
      const cc = circumcircle(...tris[ti]);
      if (cc && Math.hypot(p.x - cc.x, p.y - cc.y) < cc.r - 1e-8) bad.push(ti);
    }
    const edges = [];
    for (const ti of bad) {
      const [a, b, c] = tris[ti];
      edges.push([a, b], [b, c], [c, a]);
    }
    const badSet = new Set(bad);
    tris = tris.filter((_, i) => !badSet.has(i));
    const edgeCount = new Map();
    for (const [a, b] of edges) {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
    }
    for (const [key, count] of edgeCount) {
      if (count === 1) {
        const [a, b] = key.split(',').map(Number);
        tris.push([a, b, pi]);
      }
    }
  }

  const edgeSet = new Set();
  const triangles = [];
  for (const [a, b, c] of tris) {
    if (a >= n || b >= n || c >= n) continue;
    triangles.push([a, b, c]);
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      edgeSet.add(u < v ? `${u},${v}` : `${v},${u}`);
    }
  }
  return {
    edges: [...edgeSet].map((e) => e.split(',').map(Number)),
    triangles,
  };
}

function connectedComponents(mask, w, h, minArea) {
  const visited = new Uint8Array(w * h);
  const comps = [];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i] || visited[i]) continue;
      const qx = [x],
        qy = [y];
      visited[i] = 1;
      let sumX = 0,
        sumY = 0,
        area = 0;
      let minXX = x,
        maxXX = x,
        minYY = y,
        maxYY = y;
      while (qx.length) {
        const cx = qx.pop();
        const cy = qy.pop();
        sumX += cx;
        sumY += cy;
        area++;
        minXX = Math.min(minXX, cx);
        maxXX = Math.max(maxXX, cx);
        minYY = Math.min(minYY, cy);
        maxYY = Math.max(maxYY, cy);
        for (const [dx, dy] of dirs) {
          const nx = cx + dx,
            ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!mask[ni] || visited[ni]) continue;
          visited[ni] = 1;
          qx.push(nx);
          qy.push(ny);
        }
      }
      if (area >= minArea) {
        comps.push({
          x: sumX / area,
          y: sumY / area,
          area,
          w: maxXX - minXX + 1,
          h: maxYY - minYY + 1,
          minX: minXX,
          maxX: maxXX,
          minY: minYY,
          maxY: maxYY,
        });
      }
    }
  }
  return comps;
}

function angleScore(a, b) {
  // Prefer edges near 0°, 60°, 120° (triangular lattice)
  let ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  ang = ((ang % 180) + 180) % 180;
  const targets = [0, 60, 120];
  let best = 30;
  for (const t of targets) {
    best = Math.min(best, Math.abs(ang - t), 180 - Math.abs(ang - t));
  }
  return best; // lower is better
}

(async () => {
  const { data, info } = await sharp(SRC)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;

  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * channels;
    const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    dark[i] = lum < 215 ? 1 : 0;
  }

  const figureMask = new Uint8Array(w * h);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (!dark[i]) continue;
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          n += dark[(y + dy) * w + (x + dx)];
        }
      }
      if (n >= 11) figureMask[i] = 1;
    }
  }

  // Dilate for cleaner cutouts
  const dilated = new Uint8Array(w * h);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      let any = 0;
      for (let dy = -2; dy <= 2 && !any; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (figureMask[(y + dy) * w + (x + dx)]) {
            any = 1;
            break;
          }
        }
      }
      dilated[y * w + x] = any;
    }
  }

  let comps = connectedComponents(dilated, w, h, 100);
  comps = comps
    .filter((c) => c.area >= 140 && c.w > 10 && c.h > 14)
    .sort((a, b) => b.area - a.area);
  console.log(
    'figures',
    comps.length,
    comps.map((c) => Math.round(c.area))
  );

  // One colored circle behind each figure — large enough to read around the body
  const figureNodes = comps.map((c, idx) => {
    const cx = (c.minX + c.maxX) / 2;
    const cy = c.minY + c.h * 0.38; // upper torso / head area
    const r = Math.max(14, Math.min(34, Math.max(c.w, c.h) * 0.42));
    return {
      x: cx,
      y: cy,
      r,
      color: COLORS[idx % COLORS.length],
      figure: true,
      area: c.area,
    };
  });

  // Small structural nodes for a fuller mesh (between figures), fewer & smaller
  const structural = [];
  for (let i = 0; i < figureNodes.length; i++) {
    for (let j = i + 1; j < figureNodes.length; j++) {
      const d = dist(figureNodes[i], figureNodes[j]);
      if (d < 70 || d > 140) continue;
      const mx = (figureNodes[i].x + figureNodes[j].x) / 2;
      const my = (figureNodes[i].y + figureNodes[j].y) / 2;
      // slight offset toward triangular lattice
      const ox = ((i + j) % 2 === 0 ? 1 : -1) * 6;
      const oy = ((i + j) % 3 === 0 ? 1 : -1) * 5;
      const p = { x: mx + ox, y: my + oy };
      if (
        figureNodes.every((n) => dist(n, p) > 32) &&
        structural.every((n) => dist(n, p) > 36)
      ) {
        structural.push({
          ...p,
          r: 5 + (idxHash(i, j) % 4),
          color: COLORS[(i * 3 + j) % COLORS.length],
          figure: false,
        });
      }
    }
  }
  // keep at most ~8 structural nodes, preferring those that improve grid-like angles
  structural.sort((a, b) => a.x + a.y - (b.x + b.y));
  const picked = structural.slice(0, 8);

  const allNodes = figureNodes.concat(picked);
  let { edges } = delaunay(allNodes);

  // Score edges: keep shorter + more lattice-aligned; drop long messy chords
  const scored = edges.map(([a, b]) => {
    const A = allNodes[a],
      B = allNodes[b];
    const d = dist(A, B);
    const ang = angleScore(A, B);
    return { a, b, d, ang, score: d * 0.02 + ang * 0.8 };
  });
  scored.sort((u, v) => u.score - v.score);

  // Ensure each figure has at least 2 connections, prefer triangulation edges that score well
  const maxLen =
    scored.map((e) => e.d).sort((a, b) => a - b)[Math.floor(scored.length * 0.72)] ||
    200;
  let kept = scored.filter((e) => e.d <= maxLen && e.ang <= 28);

  // Connectivity fix for figure nodes
  const deg = new Array(allNodes.length).fill(0);
  for (const e of kept) {
    deg[e.a]++;
    deg[e.b]++;
  }
  for (let i = 0; i < figureNodes.length; i++) {
    if (deg[i] >= 2) continue;
    const candidates = scored
      .filter((e) => (e.a === i || e.b === i) && !kept.includes(e))
      .sort((u, v) => u.d - v.d);
    for (const c of candidates) {
      if (deg[i] >= 2) break;
      if (c.d > maxLen * 1.25) continue;
      kept.push(c);
      deg[c.a]++;
      deg[c.b]++;
    }
  }

  // Deduplicate
  const seen = new Set();
  kept = kept.filter((e) => {
    const key = e.a < e.b ? `${e.a},${e.b}` : `${e.b},${e.a}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const tri = 26;
  const hTri = (tri * Math.sqrt(3)) / 2;
  const gridPaths = [];
  for (let row = -1; row < h / hTri + 2; row++) {
    const y = row * hTri;
    const xOff = row % 2 === 0 ? 0 : tri / 2;
    for (let col = -1; col < w / tri + 2; col++) {
      const x = col * tri + xOff;
      gridPaths.push(`M${x},${y} L${x + tri},${y}`);
      gridPaths.push(`M${x},${y} L${x + tri / 2},${y + hTri}`);
      gridPaths.push(`M${x + tri},${y} L${x + tri / 2},${y + hTri}`);
    }
  }

  const bgSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <path d="${gridPaths.join(' ')}" fill="none" stroke="#C8C8C8" stroke-width="0.55" stroke-dasharray="1.5 2.5" stroke-linecap="butt"/>
</svg>`;

  // Circles first (behind), then lines on top of circles but under people
  const netSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  ${allNodes
    .map((n) => {
      // figure circles slightly larger so they read behind bodies
      const r = n.figure ? n.r : n.r;
      const op = n.figure ? 0.92 : 1;
      return `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${n.color}" fill-opacity="${op}"/>`;
    })
    .join('\n')}
  ${kept
    .map((e) => {
      const A = allNodes[e.a],
        B = allNodes[e.b];
      return `<line x1="${A.x.toFixed(1)}" y1="${A.y.toFixed(1)}" x2="${B.x.toFixed(1)}" y2="${B.y.toFixed(1)}" stroke="#1a1a1a" stroke-width="1.4" stroke-linecap="round"/>`;
    })
    .join('\n')}
</svg>`;

  const people = Buffer.alloc(w * h * 4, 0);
  for (let i = 0; i < w * h; i++) {
    if (!dilated[i]) continue;
    const o = i * channels;
    people[o] = data[o];
    people[o + 1] = data[o + 1];
    people[o + 2] = data[o + 2];
    people[o + 3] = 255;
  }

  const scale = 3;
  const W = w * scale;
  const H = h * scale;

  const base = await sharp(Buffer.from(bgSvg))
    .resize(W, H, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const network = await sharp(Buffer.from(netSvg))
    .resize(W, H, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const peopleLayer = await sharp(people, {
    raw: { width: w, height: h, channels: 4 },
  })
    .resize(W, H, { kernel: 'lanczos3' })
    .png()
    .toBuffer();

  await sharp(base)
    .composite([
      { input: network, blend: 'over' },
      { input: peopleLayer, blend: 'over' },
    ])
    .png()
    .toFile(OUT);

  console.log('wrote', OUT);
  console.log('nodes', allNodes.length, 'edges', kept.length);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

function idxHash(i, j) {
  return (i * 17 + j * 31) % 97;
}
