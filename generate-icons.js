// generate-icons.js - Node.js script to create PNG icons without external dependencies
'use strict';

const zlib = require('zlib');
const fs   = require('fs');

// ── CRC32 ──────────────────────────────────────────────
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const tb = Buffer.from(type, 'ascii');
  const lb = Buffer.alloc(4); lb.writeUInt32BE(data.length);
  const cb = Buffer.alloc(4); cb.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([lb, tb, data, cb]);
}

// ── PNG builder ────────────────────────────────────────
function makePNG(w, h, drawFn) {
  const px = new Uint8Array(w * h * 3);

  const set = (x, y, r, g, b) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const i = (y * w + x) * 3;
    px[i] = r; px[i+1] = g; px[i+2] = b;
  };

  const fillRect = (x0, y0, rw, rh, r, g, b) => {
    for (let y = y0; y < y0+rh; y++)
      for (let x = x0; x < x0+rw; x++) set(x, y, r, g, b);
  };

  const fillEllipse = (cx, cy, rx, ry, r, g, b) => {
    for (let y = Math.floor(cy-ry); y <= Math.ceil(cy+ry); y++)
      for (let x = Math.floor(cx-rx); x <= Math.ceil(cx+rx); x++) {
        const dx = (x-cx)/rx, dy = (y-cy)/ry;
        if (dx*dx + dy*dy <= 1) set(x, y, r, g, b);
      }
  };

  drawFn({ w, h, set, fillRect, fillEllipse });

  // Build scanlines (filter byte 0 per row)
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w*3)] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y*w+x)*3, d = y*(1+w*3)+1+x*3;
      raw[d] = px[s]; raw[d+1] = px[s+1]; raw[d+2] = px[s+2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Draw poop icon ─────────────────────────────────────
function drawIcon({ w, h, fillRect, fillEllipse }) {
  const cx = w / 2;

  // Sky blue background
  fillRect(0, 0, w, h, 135, 206, 235);

  // Grass
  fillRect(0, Math.round(h*0.78), w, Math.round(h*0.13), 90, 184, 90);
  // Dirt
  fillRect(0, Math.round(h*0.88), w, Math.round(h*0.12), 125, 81, 36);

  // Poop body (bottom → top)
  fillEllipse(cx, h*0.70, w*0.34, h*0.13, 107, 58, 42);  // base
  fillEllipse(cx, h*0.57, w*0.26, h*0.15, 123, 65, 50);  // middle
  fillEllipse(cx, h*0.44, w*0.18, h*0.14, 139, 74, 56);  // upper
  fillEllipse(cx, h*0.32, w*0.12, w*0.12, 139, 74, 56);  // tip

  // Eyes — white
  fillEllipse(cx - w*0.07, h*0.555, w*0.042, w*0.042, 255, 255, 255);
  fillEllipse(cx + w*0.07, h*0.555, w*0.042, w*0.042, 255, 255, 255);
  // Pupils
  fillEllipse(cx - w*0.065, h*0.562, w*0.022, w*0.022, 30, 20, 10);
  fillEllipse(cx + w*0.065, h*0.562, w*0.022, w*0.022, 30, 20, 10);

  // Smile (simple arc approximation via rectangles)
  for (let i = -3; i <= 3; i++) {
    const sx = Math.round(cx + i * w*0.025);
    const sy = Math.round(h*0.615 + Math.abs(i) * h*0.012);
    fillEllipse(sx, sy, w*0.012, h*0.012, 40, 20, 10);
  }
}

// ── Generate all needed sizes ──────────────────────────
const sizes = [
  { size: 180, name: 'apple-touch-icon' },
  { size: 192, name: 'icon-192'         },
  { size: 512, name: 'icon-512'         },
];

for (const { size, name } of sizes) {
  const buf = makePNG(size, size, drawIcon);
  fs.writeFileSync(`icons/${name}.png`, buf);
  console.log(`✓ icons/${name}.png  (${size}x${size}, ${buf.length} bytes)`);
}
