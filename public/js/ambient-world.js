import { region } from './geo.js';
import { windArrival, windGust } from './wind.js';
import { LIFE_MIN_ZOOM, STREET_LIFE_ZOOM } from './life-lod.js';

const tau = 2 * Math.PI;
const lift = Math.sqrt(1 - region.pitch ** 2);
const skyCell = 346;
const cloudWidth = 308;
const cloudHeight = 158;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const smooth = (value) => value * value * (3 - 2 * value);
const envelope = (value) => smooth(clamp(value, 0, 1));

function hash(value) {
  let bits = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  bits = Math.imul(bits ^ (bits >>> 15), 0x735a2d97);
  return (bits ^ (bits >>> 15)) >>> 0;
}

function random(seed) {
  return hash(seed) / 4294967296;
}

function regionSeed(id, [x, y]) {
  let value = Math.imul(Math.round(x), 433) + Math.imul(Math.round(y), 809);
  for (const char of String(id)) value = Math.imul(value, 31) + char.charCodeAt(0);
  return hash(value);
}

function visible(x, y, frame, pad) {
  return x >= -pad && x <= frame.width + pad && y >= -pad && y <= frame.height + pad;
}

function cloudTexture(seed) {
  const width = 144;
  const height = 76;
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) :
    Object.assign(document.createElement('canvas'), {width, height});
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.scale(1, .62);
  for (const [index, [x, y, radius]] of [[52, 66, 38], [85, 57, 45], [111, 76, 25]].entries()) {
    const xx = x + (random(seed + index * 13) - .5) * 9;
    const yy = y + (random(seed + index * 29) - .5) * 22;
    const shade = context.createRadialGradient(xx, yy, radius * .15, xx, yy, radius);
    shade.addColorStop(0, 'rgba(50, 55, 85, .28)');
    shade.addColorStop(.42, 'rgba(50, 55, 85, .21)');
    shade.addColorStop(.75, 'rgba(61, 57, 88, .075)');
    shade.addColorStop(1, 'rgba(61, 54, 79, 0)');
    context.fillStyle = shade;
    context.fillRect(xx - radius, yy - radius, 2 * radius, 2 * radius);
  }
  return canvas;
}

function paintClouds(context, textures, frame, seconds) {
  const {origin: [ox, oy], zoom, width, height, coverage} = frame;
  const driftX = seconds * 9.2;
  const driftY = seconds * 1.61;
  const left = (-ox) / zoom - driftX;
  const top = (-oy) / zoom - driftY;
  const right = left + width / zoom;
  const bottom = top + height / zoom;
  const previousSmoothing = context.imageSmoothingEnabled;
  const previousAlpha = context.globalAlpha;
  let painted=0;
  if (coverage) {
    const [x, y, ex, ey] = coverage;
    context.save();
    context.beginPath();
    context.rect(ox + x * zoom, oy + y * zoom, (ex - x) * zoom, (ey - y) * zoom);
    context.clip();
  }
  context.imageSmoothingEnabled = true;
  for (let gy = Math.floor((top - cloudHeight) / skyCell); gy <= Math.floor((bottom + cloudHeight) / skyCell); gy++) {
    for (let gx = Math.floor((left - cloudWidth) / skyCell); gx <= Math.floor((right + cloudWidth) / skyCell); gx++) {
      const seed = hash(Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663));
      if (random(seed) < .14) continue;
      const x = (gx + .2 + random(seed + 6) * .6) * skyCell + driftX;
      const y = (gy + .2 + random(seed + 19) * .6) * skyCell + driftY;
      const stretches = .83 + random(seed + 29) * .55;
      const w = cloudWidth * stretches * zoom;
      const h = cloudHeight * (.88 + random(seed + 12) * .42) * zoom;
      const sx = ox + x * zoom - w / 2;
      const sy = oy + y * zoom - h / 2;
      if (sx >= width || sy >= height || sx + w <= 0 || sy + h <= 0) continue;
      context.globalAlpha = previousAlpha * (.67 + random(seed + 3) * .30);
      const texture = textures[seed % textures.length];
      if (texture) {
        context.drawImage(texture, sx, sy, w, h);
        painted++;
      }
    }
  }
  if (coverage) context.restore();
  else {
    context.imageSmoothingEnabled = previousSmoothing;
    context.globalAlpha = previousAlpha;
  }
  return painted;
}

function paintLeaf(context, x, y, size, turn, facing, light, seed) {
  context.save();
  context.translate(x, y);
  context.rotate(turn);
  context.scale(size, size * facing);
  context.fillStyle = '#785339';
  context.beginPath();
  context.moveTo(-1.08, .20);
  context.quadraticCurveTo(-.48, -.65, .12, -.60);
  context.quadraticCurveTo(.69, -.58, .94, -.36);
  context.quadraticCurveTo(.75, .24, .19, .51);
  context.quadraticCurveTo(-.50, .71, -1.08, .20);
  context.fill();
  context.fillStyle = seed ? '#f2d59a' : light ? '#e8c071' : '#bb914f';
  context.beginPath();
  context.moveTo(-.82, .18);
  context.quadraticCurveTo(-.32, -.48, .17, -.46);
  context.lineTo(.79, -.31);
  context.quadraticCurveTo(.26, .18, -.82, .18);
  context.fill();
  context.restore();
}

function paintLeaves(context, frame, seconds, crowns, occlusion) {
  if (frame.zoom < STREET_LIFE_ZOOM) return 0;
  const alpha = context.globalAlpha;
  const {origin: [ox, oy], zoom} = frame;
  let painted = 0;
  for (const [tx, ty, radius, treeSeed, conifer] of crowns) {
    if (painted >= 16) break;
    if (radius * zoom < 3.65) continue;
    const seed = hash(treeSeed) + hash(Math.round(tx) + Math.imul(Math.round(ty), 349));
    if (seed % (conifer ? 8 : 4) !== 0) continue;
    if (!visible(ox + tx * zoom, oy + ty * zoom, frame, 46 * zoom)) continue;
    const period = 10.6 + random(seed + 29) * 7.8;
    const offset = random(seed + 1) * period;
    const elapsed = seconds + offset;
    const departed = elapsed - Math.floor(elapsed / period) * period;
    const age = departed - random(seed + 7) * .7;
    if (age < 0 || age > 5.8) continue;
    const release = seconds - age;
    const gust = windGust(windArrival(tx, ty, treeSeed, release));
    if (gust < .14) continue;
    const count = !conifer && gust > .48 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const variant = seed + 15 * i;
      const flight = 4.05 + random(variant + 18) * 1.75;
      const time = age - i * .37;
      if (time < 0 || time >= flight) continue;
      const t = time / flight;
      const drift = 3.6 + gust * 2.25 + random(variant + 13) * 1.8;
      const curl = Math.sin(time * 2.1 + random(variant + 12) * tau);
      const x = tx + radius * .67 + drift * time - time * time * .19 + curl * t * 1.6;
      const y = ty + (i - .35) * radius * .30 + time * (random(variant + 8) - .28) * 1.15 + curl * t * 1.8;
      const height = Math.max(.18, radius * (conifer ? 2.8 : 1.94) * (1 - t ** 1.45) + Math.sin(t * tau * 1.17) * t * 1.24);
      const dx = ox + x * zoom;
      const dy = oy + (y - height * lift) * zoom;
      if (!visible(dx, dy, frame, 6)) continue;
      const open = occlusion(x, y, height);
      if (open < .05) continue;
      context.globalAlpha = alpha * open * envelope(t * 13) * envelope((1 - t) * 6);
      const size = clamp(zoom * (conifer ? .94 : 1.18), 1.78, 3.85);
      const turn = time * (1.6 + random(variant + 11) * 1.12) + random(variant + 37) * tau;
      const facing = .45 + .55 * Math.abs(Math.cos(time * 2.8 + i));
      paintLeaf(context, dx, dy, size, turn, facing, curl > -.24, conifer);
      painted++;
    }
  }
  context.globalAlpha = alpha;
  return painted;
}

function wing(context, sign, beat, pale) {
  const reach = sign * (2.18 + .91 * beat);
  const sweep = -.34 + beat * .83;
  const tip = -1.78 + beat * 1.87;
  context.beginPath();
  context.moveTo(.73, sign * .18);
  context.quadraticCurveTo(.85, sign * 1.38, sweep, reach * .64);
  context.lineTo(tip, reach);
  context.quadraticCurveTo(tip + .22, reach * .56, -.73, sign * .72);
  context.lineTo(-.94, sign * .30);
  context.closePath();
  context.fillStyle = pale ? '#c5c6b5' : '#919d9a';
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(sweep, reach * .64);
  context.lineTo(tip, reach);
  context.lineTo(tip + .23, reach * .64);
  context.lineTo(sweep - .24, reach * .48);
  context.fillStyle = '#536267';
  context.fill();
}

function paintBird(context, x, y, size, bearing, beat, pale) {
  context.save();
  context.translate(x, y);
  context.rotate(bearing);
  context.scale(size, size);
  context.strokeStyle = '#465052';
  context.lineWidth = .32;
  context.lineJoin = 'round';
  wing(context, -1, clamp(beat * .92 + .10, -1, 1), pale);
  wing(context, 1, clamp(beat * .96 - .04, -1, 1), pale);
  context.beginPath();
  context.moveTo(2.00, -.07);
  context.lineTo(1.17, -.44);
  context.quadraticCurveTo(.32, -.58, -.52, -.29);
  context.lineTo(-1.70, -.39);
  context.lineTo(-1.49, .33);
  context.lineTo(-.42, .25);
  context.quadraticCurveTo(.49, .56, 1.36, .34);
  context.closePath();
  context.fillStyle = pale ? '#e7debd' : '#bfc0ae';
  context.fill();
  context.stroke();
  context.restore();
}

function paintBirds(context, frame, seconds, regions, occlusion) {
  if (frame.zoom < STREET_LIFE_ZOOM) return 0;
  const {origin: [ox, oy], zoom} = frame;
  const alpha = context.globalAlpha;
  let count = 0;
  for (const {id, anchor, birds} of regions) {
    if (!birds?.length || count >= 11) continue;
    const seed = regionSeed(id, anchor);
    const period = 15 + random(seed + 9) * 9;
    const firstFlight = 1.15 + random(seed + 7) * 1.35;
    const event = Math.floor((seconds - firstFlight) / period);
    const since = seconds - firstFlight - event * period;
    const flightSeed = hash(seed + event * 113);
    const flight = 8.6 + random(flightSeed + 23) * 2.8;
    if (since > flight + 1.4) continue;
    const [startX, startY] = birds[flightSeed % birds.length];
    const liftWind=windGust(windArrival(startX,startY,seed,seconds-since));
    const awayX = anchor[0] - startX;
    const awayY = (anchor[1] - startY) / region.pitch;
    const pathBearing = Math.hypot(awayX, awayY) > 18 ? Math.atan2(awayY, awayX) :
      random(flightSeed + 198) * tau;
    const speed = 4.9 + random(flightSeed + 4) * 2.16 + liftWind*.85;
    const turn = (random(flightSeed + 88) - .42) * .20;
    const members = Math.min(11 - count, 2 + flightSeed % 3);
    for (let i = 0; i < members; i++) {
      const member = flightSeed + i * 17;
      const age = since - i * .26;
      if (age < 0 || age > flight) continue;
      const t = age / flight;
      const theta = pathBearing + turn * age * .64;
      const distance = speed * (age - .79 * (1 - Math.exp(-age / .78)));
      const spacing = i === 0 ? 0 : Math.ceil(i / 2) * 2.3 * (i % 2 ? -1 : 1);
      const lateral = spacing * (.60 + t) + Math.sin(age * 1.18 + i * 2.4) * t * 1.72;
      const x = startX + Math.cos(theta) * distance - Math.sin(theta) * lateral;
      const y = startY + (Math.sin(theta) * distance + Math.cos(theta) * lateral) * region.pitch;
      const altitude = .65 + (18 + random(member + 29) * 8.5) * envelope(age / 2.75) +
        Math.sin(age * 2.3 + i * .62) * t * .92;
      const dx = ox + x * zoom;
      const dy = oy + (y - altitude * lift) * zoom;
      if (!visible(dx, dy, frame, 9)) continue;
      const open = occlusion?.(x, y, altitude) ?? 1;
      if (open < .07) continue;
      const flap = Math.sin(age * (tau * (4.4 + random(member + 85) * .63)) + i * 1.3);
      const glide = envelope((age - 2.5) / 4) * (.47 + liftWind*.19 + Math.max(0, Math.sin(age * 1.86 + i)) * .32);
      const beat = flap * (1 - glide) + glide * .64;
      const heading = pathBearing + turn * age * 1.28;
      const bearing = Math.atan2(Math.sin(heading) * region.pitch, Math.cos(heading));
      const size = clamp(zoom * (.92 + random(member + 6) * .22), 1.18, 3.08);
      context.globalAlpha = alpha * open * envelope(age * 2.8) * envelope((flight - age) * .94);
      paintBird(context, dx, dy, size, bearing, beat, member % 4 < 2);
      count++;
    }
  }
  context.globalAlpha = alpha;
  return count;
}

export function createAmbientWorld() {
  let textures;
  return function paint(context, frame, seconds, visibleRegions, visibleCrowns, occlusion, diagnostics) {
    if (frame.width < 1 || frame.height < 1 || frame.zoom < LIFE_MIN_ZOOM) return;
    const regions = Array.isArray(visibleRegions) ? visibleRegions : Array.from(visibleRegions ?? []);
    textures ??= [23, 378, 602].map(cloudTexture);
    const clouds=paintClouds(context, textures, frame, seconds);
    const leaves=paintLeaves(context, frame, seconds, visibleCrowns ?? [], occlusion);
    const birds=paintBirds(context, frame, seconds, regions, occlusion);
    if (diagnostics) return {clouds,leaves,birds};
  };
}
