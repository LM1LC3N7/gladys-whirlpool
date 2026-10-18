// Generates cover.png (800x534) for gladys-whirlpool: plain Node, no dependency.
// A washer and an oven with a "cycle done" badge on a blue gradient (no brand logo).
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = (x / W + y / H) / 2;
    set(x, y, [24 + 30 * t, 70 + 40 * t, 140 + 50 * t]);
  }
}
const white = [255, 255, 255];
const dark = [28, 44, 80];
const warm = [255, 205, 90];
const glow = [255, 236, 170];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const line = (x0, y0, x1, y1, width, color, alpha = 1) => {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
disc(400, 270, 240, white, 0.06);

// Washer on the left: body, control strip, door, drum, water.
box(110, 120, 350, 440, 22, white);
box(110, 120, 350, 175, 22, [225, 232, 245]);
box(130, 138, 220, 158, 8, dark, 0.8);
disc(300, 148, 12, warm);
disc(230, 300, 98, dark);
disc(230, 300, 80, [120, 170, 230]);
for (let x = 152; x <= 308; x += 1) {
  const y = 315 + Math.sin(x / 14) * 8;
  const bottom = 300 + Math.sqrt(Math.max(0, 78 ** 2 - (x - 230) ** 2));
  if (bottom > y) line(x, y, x, bottom, 2, [70, 130, 210], 0.9);
}
disc(230, 300, 80, white, 0.08);
// Bubbles.
for (const [x, y, r] of [
  [200, 270, 9],
  [250, 255, 6],
  [270, 290, 7],
]) {
  disc(x, y, r, white, 0.8);
}

// Oven on the right: body, knobs, window, glow, thermometer.
box(450, 140, 690, 440, 22, white);
for (const x of [490, 540, 600, 650]) {
  disc(x, 172, 13, dark, 0.85);
}
box(480, 215, 660, 400, 16, dark);
box(495, 230, 645, 385, 12, [255, 150, 60], 0.85);
disc(570, 310, 70, glow, 0.35);
line(495, 360, 645, 360, 6, white, 0.6);
// Cycle-done check mark badge.
disc(330, 440, 46, warm);
line(310, 440, 326, 456, 10, dark);
line(326, 456, 356, 422, 10, dark);
// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2], png);
console.log('cover', png.length, 'bytes');
