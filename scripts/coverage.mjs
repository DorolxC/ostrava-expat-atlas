import { project } from '../public/js/geo.js';
import { Raster, mix } from './raster.mjs';

const GRID = 22;
const FADE_START = 75;
const FADE_END = 830;

export function projectedRings(shape) {
  const geometry = shape.geometry ?? shape;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flat().map((ring) => ring.map(([lon, lat]) => project(lon, lat)));
}

export function extent(rings) {
  const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const ring of rings) {
    for (const [x, y] of ring) {
      box.left = Math.min(box.left, x);
      box.top = Math.min(box.top, y);
      box.right = Math.max(box.right, x);
      box.bottom = Math.max(box.bottom, y);
    }
  }
  return box;
}

// Rasterise the administrative boundary once, then measure distance outward on a coarse grid.
// Map y is foreshortened, so the cost along that axis is greater than along x.
export function coverageField(rings, pitch, margin = 960) {
  const box = extent(rings);
  const west = Math.floor((box.left - margin) / GRID) * GRID;
  const north = Math.floor((box.top - margin * pitch - 160) / GRID) * GRID;
  const width = Math.ceil((box.right + margin - west) / GRID);
  const height = Math.ceil((box.bottom + margin * pitch - north) / GRID);
  const raster = new Raster(width, height, 0);
  raster.polygon(rings.map((ring) => ring.map(([x,y]) => [(x-west)/GRID,(y-north)/GRID])), 1);
  const distance = Float32Array.from(raster.pixels, (inside) => inside ? 0 : Infinity);
  const vertical = GRID / pitch;
  const diagonal = Math.hypot(GRID, vertical);

  function pass(reverse) {
    const direction = reverse ? -1 : 1;
    const xStart = reverse ? width - 1 : 0;
    const yStart = reverse ? height - 1 : 0;
    for (let row = 0, y = yStart; row < height; row++, y += direction) {
      for (let col = 0, x = xStart; col < width; col++, x += direction) {
        const i = y * width + x;
        let candidate = distance[i];
        if (candidate === 0) continue;
        if (col > 0) candidate = Math.min(candidate, distance[i-direction] + GRID);
        if (row > 0) {
          const adjacent = i - direction * width;
          candidate = Math.min(candidate, distance[adjacent] + vertical);
          if (x > 0) candidate = Math.min(candidate, distance[adjacent-1] + diagonal);
          if (x + 1 < width) candidate = Math.min(candidate, distance[adjacent+1] + diagonal);
        }
        distance[i] = candidate;
      }
    }
  }
  pass(false);
  pass(true);

  const alpha = Float32Array.from(distance, (d) => {
    const t = Math.max(0, Math.min(1, (d - FADE_START) / (FADE_END - FADE_START)));
    return 1 - t*t*(3-2*t);
  });
  function containsArea(left, top, right, bottom) {
    const x0 = Math.max(0, Math.floor((left-west)/GRID));
    const y0 = Math.max(0, Math.floor((top-north)/GRID));
    const x1 = Math.min(width-1, Math.ceil((right-west)/GRID));
    const y1 = Math.min(height-1, Math.ceil((bottom-north)/GRID));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (alpha[y*width+x] > 0.004) return true;
      }
    }
    return false;
  }

  function blend(raster, scale, ox, oy, background) {
    for (let y = 0; y < raster.height; y++) {
      const gy = ((y+oy+0.5)/scale-north)/GRID-0.5;
      const row = Math.floor(gy);
      const fy = gy-row;
      if (row < 0 || row >= height-1) {
        raster.pixels.fill(background,y*raster.width,(y+1)*raster.width);
        continue;
      }
      for (let x = 0; x < raster.width; x++) {
        const gx = ((x+ox+0.5)/scale-west)/GRID-0.5;
        const col = Math.floor(gx);
        const at = y*raster.width+x;
        if (col < 0 || col >= width-1) {
          raster.pixels[at] = background;
          continue;
        }
        const fx = gx-col;
        const index = row*width+col;
        const a = alpha[index] + (alpha[index+1] - alpha[index])*fx;
        const b = alpha[index+width] + (alpha[index+width+1] - alpha[index+width])*fx;
        const strength = a+(b-a)*fy;
        if (strength > 0.997) continue;
        raster.pixels[at] = strength <= 0.004 ? background : mix(background, raster.pixels[at], strength);
      }
    }
  }

  return { box, containsArea, blend, frame: { left: west, top: north, right: west+width*GRID, bottom: north+height*GRID } };
}
