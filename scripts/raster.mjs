import { deflateSync } from 'node:zlib';

export function rgb(hex) {
  return Number.parseInt(hex.replace('#', ''), 16);
}
export function shade(color, delta) {
  const channel = (value) => Math.max(0, Math.min(255, value + delta));
  return (channel(color >> 16) << 16) | (channel((color >> 8) & 255) << 8) | channel(color & 255);
}
export function mix(a, b, t) {
  const red = Math.round((a >> 16) + ((b >> 16) - (a >> 16)) * t);
  const green = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const blue = Math.round((a & 255) + ((b & 255) - (a & 255)) * t);
  return (red << 16) | (green << 8) | blue;
}
export function noise(x, y, salt = 0) {
  const mixed = Math.imul(x ^ salt, 0x45d9f3b) ^ Math.imul(y + salt, 0x27d4eb2d);
  const hash = Math.imul(mixed ^ (mixed >>> 15), 0x2c1b3c6d);
  return ((hash ^ (hash >>> 13)) >>> 0) / 4294967296;
}

export class Raster {
  constructor(width, height, background, useDepth = false) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint32Array(width * height).fill(background);
    this.depth = useDepth ? new Float32Array(width * height).fill(-Infinity) : null;
  }

  pixel(x, y, color, depth) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const index = y * this.width + x;
    if (depth !== undefined) {
      if (depth < this.depth[index]) return;
      this.depth[index] = depth;
    }
    this.pixels[index] = color;
  }

  // Even-odd fill across all rings preserves courtyards and water holes.
  polygon(rings, paint) {
    const edges = [];
    let low = this.height;
    let high = 0;
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        let [x0, y0] = ring[i];
        let [x1, y1] = ring[(i + 1) % ring.length];
        if (y0 > y1) [x0, y0, x1, y1] = [x1, y1, x0, y0];
        if (y0 === y1) continue;
        edges.push([x0, y0, y1, (x1 - x0) / (y1 - y0)]);
        low = Math.min(low, y0);
        high = Math.max(high, y1);
      }
    }
    const hits = [];
    for (let y = Math.max(0, Math.ceil(low - 0.5)); y < Math.min(this.height, high - 0.5); y++) {
      hits.length = 0;
      const sampleY = y + 0.5;
      for (const [x0, y0, y1, slope] of edges) {
        if (sampleY >= y0 && sampleY < y1) hits.push(x0 + (sampleY - y0) * slope);
      }
      hits.sort((a, b) => a - b);
      for (let i = 0; i + 1 < hits.length; i += 2) {
        const left = Math.max(0, Math.ceil(hits[i] - 0.5));
        const right = Math.min(this.width, Math.ceil(hits[i + 1] - 0.5));
        if (typeof paint === 'number') {
          this.pixels.fill(paint, y * this.width + left, y * this.width + Math.max(left, right));
        } else {
          for (let x = left; x < right; x++) paint(x, y);
        }
      }
    }
  }

  ellipse(cx, cy, rx, ry, paint) {
    for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(this.height, Math.ceil(cy + ry)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(this.width, Math.ceil(cx + rx)); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) paint(x, y, dx, dy);
      }
    }
  }
}

const crcTable = Uint32Array.from({length: 256}, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});
function chunk(name, data) {
  const type = Buffer.from(name);
  let crc = 0xffffffff;
  for (const part of [type, data]) {
    for (const byte of part) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  type.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return result;
}

export function png(raster, x0 = 0, y0 = 0, width = raster.width, height = raster.height, step = 1, compression = 5, alphaAt) {
  const stride = alphaAt ? 4 : 3;
  const line = 1 + width * stride;
  const raw = Buffer.allocUnsafe(line * height);
  for (let y = 0; y < height; y++) {
    raw[y * line] = 1;
    let previous = 0;
    let previousAlpha = 0;
    for (let x = 0; x < width; x++) {
      const value = raster.pixels[(y0 + y * step) * raster.width + x0 + x * step];
      const at = y * line + 1 + x * stride;
      raw[at] = (value >> 16) - (previous >> 16);
      raw[at + 1] = (value >> 8) - (previous >> 8);
      raw[at + 2] = value - previous;
      if (alphaAt) {
        const alpha = alphaAt(x,y);
        raw[at + 3] = alpha - previousAlpha;
        previousAlpha = alpha;
      }
      previous = value;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = alphaAt ? 6 : 2;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: compression })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
