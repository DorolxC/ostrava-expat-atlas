import { region } from './geo.js';
import { environmentPainter, environmentPadding } from './environment.js';
import { loadDynamicWorld } from './dynamic-world.js';
import { assetURL } from './asset-url.js';
import { LIFE_MIN_ZOOM, STREET_LIFE_ZOOM } from './life-lod.js';

export { LIFE_MIN_ZOOM } from './life-lod.js';
const cellSize = 360;
const pitch = region.pitch;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const ease = (value) => value * value * (3 - 2 * value);

function spatialIndex(records) {
  const cells = new Map();
  for (const record of records) {
    const [x, y] = record;
    const key = Math.floor(x / cellSize) + ',' + Math.floor(y / cellSize);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(record);
  }
  return cells;
}

function* within(cells, box) {
  for (let y = Math.floor(box.top / cellSize); y <= Math.floor(box.bottom / cellSize); y++) {
    for (let x = Math.floor(box.left / cellSize); x <= Math.floor(box.right / cellSize); x++) {
      const cell = cells.get(x + ',' + y);
      if (!cell) continue;
      for (const record of cell) {
        const [px, py] = record;
        if (px > box.left && px < box.right && py > box.top && py < box.bottom) yield record;
      }
    }
  }
}

function bounds(frame, pad = 0) {
  const [left, top] = frame.pointOnScreen([0, 0]);
  return {
    left: (-left - pad) / frame.zoom,
    top: (-top - pad) / frame.zoom,
    right: (frame.width - left + pad) / frame.zoom,
    bottom: (frame.height - top + pad) / frame.zoom,
  };
}

function trackBounds(points) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function shape(context, points, color) {
  context.beginPath();
  context.moveTo(...points[0]);
  for (let i = 1; i < points.length; i++) context.lineTo(...points[i]);
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

const roof = ['#cedfd8', '#d5ddd7', '#bccfc9'];
const bright = ['#53c4ca', '#4db5c8', '#629fbe'];
const shaded = ['#328b99', '#347c99', '#487b9b'];

function paintCar(context, at, from, to, zoom, front, light) {
  const dx = to[0] - from[0];
  const dy = (to[1] - from[1]) / pitch;
  const size = Math.hypot(dx, dy);
  if (size < 0.01) return;
  const ux = dx / size * zoom;
  const uy = dy / size * pitch * zoom;
  const vx = -dy / size * zoom;
  const vy = dx / size * pitch * zoom;
  const lift = 3.05 * Math.sqrt(1 - pitch ** 2) * zoom;
  const px = at[0];
  const py = at[1];
  const halfLength = front ? 6.05 : 5.7;
  const halfWidth = 1.36;
  function prism(along, across, level = 0) {
    return [px + ux * along + vx * across, py + uy * along + vy * across - lift * level];
  }
  const perimeter = [
    [-halfLength, -halfWidth], [halfLength - 0.65, -halfWidth],
    [halfLength, -halfWidth * 0.57], [halfLength, halfWidth * 0.57],
    [halfLength - 0.65, halfWidth], [-halfLength, halfWidth],
  ];
  shape(context, perimeter.map(([x, y]) => {
    const [a, b] = prism(x, y);
    return [a + 1.3 * zoom, b + zoom * 0.46];
  }), 'rgba(23,53,55,0.28)');

  for (let i = 0; i < perimeter.length; i++) {
    const a = perimeter[i];
    const b = perimeter[(i + 1) % perimeter.length];
    const left = prism(...a);
    const right = prism(...b);
    if ((left[1] + right[1]) / 2 < py - 0.01) continue;
    const nose = i === 2;
    const longSide = i === 0 || i === 4;
    const wallColor = i === 0 || i === 1 ? shaded[light] : bright[light];
    shape(context, [left, right, prism(...b, 1), prism(...a, 1)], wallColor);
    shape(context, [prism(...a, .16), prism(...b, .16), prism(...b, .29), prism(...a, .29)], '#92c5c5');
    shape(context, [prism(...a, .52), prism(...b, .52), prism(...b, .91), prism(...a, .91)], '#254b61');
    if (longSide && zoom > 1.03) {
      for (const part of [0.16, 0.37, 0.56, 0.79, 0.94]) {
        const slit = (fraction, level) => prism(a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction, level);
        shape(context, [slit(part, .53), slit(part + .022, .53), slit(part + .022, .91), slit(part, .91)], wallColor);
      }
    }
    if (front && nose && zoom > 0.75) {
      for (const q of [-0.44, 0.44]) {
        const [x, y] = prism(halfLength + .02, q, .36);
        context.fillStyle = '#f7edd0';
        context.fillRect(x - zoom * .22, y - zoom * .14, zoom * .44, zoom * .28);
      }
    }
  }
  shape(context, perimeter.map(([x, y]) => prism(x, y, 1)), roof[light]);
  if (zoom > 0.82) {
    shape(context, [prism(-2.9, -.55, 1.02), prism(1.6, -.55, 1.02), prism(1.6, .55, 1.02), prism(-2.9, .55, 1.02)], '#93b0ae');
    if (front && zoom > 1.12) {
      const [a, b] = prism(-0.8, 0.03, 1.07);
      const [c, d] = prism(0.67, 0, 1.58);
      const [e, f] = prism(1.9, -0.03, 1.04);
      context.strokeStyle = '#597c80';
      context.lineWidth = Math.max(0.7, zoom * .23);
      context.beginPath();
      context.moveTo(a, b);
      context.lineTo(c, d);
      context.lineTo(e, f);
      context.stroke();
    }
  }
}

function trackPoint(points, distance, step) {
  const f = clamp(distance / step, 0, points.length - 1.001);
  const i = Math.floor(f);
  const [ax, ay, a] = points[i];
  const [bx, by, b] = points[i + 1];
  const [px, py] = points[Math.max(0,i-1)];
  const [qx, qy] = points[Math.min(points.length-1,i+2)];
  const t = f - i;
  const ux=t*(1-t)*(1-t)*.5, vx=-t*t*(1-t)*.5;
  const curve=ease(t);
  const straightX=ax+(bx-ax)*t, straightY=ay+(by-ay)*t;
  const x=ax+(bx-ax)*curve+(bx-px)*ux+(qx-ax)*vx;
  const y=ay+(by-ay)*curve+(by-py)*ux+(qy-ay)*vx;
  const shift=Math.hypot(x-straightX,(y-straightY)/pitch);
  const correction=shift>.58 ? .58/shift : 1;
  return [straightX+(x-straightX)*correction,straightY+(y-straightY)*correction,a+(b-a)*t];
}

function turning(points, i) {
  const a=points[Math.max(0,i-3)], here=points[i], b=points[Math.min(points.length-1,i+3)];
  const dx=here[0]-a[0], dy=(here[1]-a[1])/pitch;
  const ex=b[0]-here[0], ey=(b[1]-here[1])/pitch;
  const legs=Math.hypot(dx,dy)*Math.hypot(ex,ey);
  return legs>.01 ? clamp(1-(dx*ex+dy*ey)/legs,0,2) : 0;
}

function routeProfile(points, controls, step, index) {
  const length=(points.length-1)*step;
  const speeds=new Float32Array(points.length);
  const times=new Float32Array(points.length);
  const cruise=7.9+index%3*.48;
  for (let i=0;i<points.length;i++) {
    const distance=i*step;
    const curve=ease(clamp((turning(points,i)-.035)/.69,0,1));
    let speed=cruise*(1-curve*.61);
    const endDistance=Math.min(distance,length-distance);
    speed=Math.min(speed,cruise-(cruise-1.65)*ease(clamp(1-endDistance/42,0,1)));
    for (const [at,isStop] of controls) {
      const range=isStop ? 41 : 33;
      const approach=clamp(1-Math.abs(at-distance)/range,0,1);
      const target=isStop ? 1.12 : cruise*.48;
      speed=Math.min(speed,cruise-(cruise-target)*ease(approach));
    }
    speeds[i]=speed;
  }
  for (let i=1;i<speeds.length;i++) speeds[i]=Math.min(speeds[i],Math.sqrt(speeds[i-1]**2+2*1.05*step));
  for (let i=speeds.length-2;i>=0;i--) speeds[i]=Math.min(speeds[i],Math.sqrt(speeds[i+1]**2+2*1.32*step));
  for (let i=1;i<speeds.length;i++) times[i]=times[i-1]+step*2/(speeds[i-1]+speeds[i]);
  return {length,speeds,times,period:times.at(-1)};
}

function travelledAt({speeds,times}, seconds, step) {
  let left=0, right=times.length-1;
  while (right-left>1) {
    const mid=(left+right)>>1;
    if (times[mid]<=seconds) left=mid;
    else right=mid;
  }
  const start=speeds[left], time=seconds-times[left];
  const acceleration=(speeds[right]-start)/(times[right]-times[left]);
  return left*step+start*time+acceleration*time*time*.5;
}

function collectTrams(visible, box, tracks, step, seconds) {
  visible.length=0;
  for (const track of tracks) {
    if (!intersects(track.box, box)) continue;
    const { points, index, profile } = track;
    const {length,period}=profile;
    const count = Math.max(1, Math.ceil(length / 560));
    for (let i = 0; i < count; i++) {
      const phase=period*(.13+index*.17+i/count);
      const at=travelledAt(profile,(seconds+phase)%period,step);
      const middle = trackPoint(points, at, step);
      if (middle[0] < box.left || middle[0] > box.right || middle[1] < box.top || middle[1] > box.bottom) continue;
      const alpha = ease(clamp((Math.min(at,length-at)-7) / 32,0,1));
      if (alpha === 0) continue;
      for (const offset of [-6.4, 6.4]) {
        const position = trackPoint(points, at + offset, step);
        const visibility=alpha*ease(position[2]);
        if (visibility<=.004) continue;
        const from = trackPoint(points,at+offset-4.4,step);
        const to = trackPoint(points,at+offset+4.4,step);
        visible.push({position,from,to,visibility,front:offset>0,color:(index+i)%bright.length});
      }
    }
  }
  visible.sort((a,b)=>a.position[1]-b.position[1]);
}

function paintTram(context,frame,{position,from,to,visibility,front,color}) {
  context.save();
  context.globalAlpha=visibility;
  paintCar(context,frame.pointOnScreen(position),frame.pointOnScreen(from),frame.pointOnScreen(to),frame.zoom,front,color);
  context.restore();
}

async function motionData(base, name, revision) {
  const response = await fetch(assetURL(base,name,revision));
  if (!response.ok) throw new Error(name+' is unavailable');
  return response.json();
}

export async function loadLife(base,manifest,probe) {
  let paintWorld;
  let worldRequested=false;
  if (probe) probe.world={state:'deferred',suppressed:'street life begins at zoom '+STREET_LIFE_ZOOM};
  const [data, crowns, flow] = await Promise.all([
    motionData(base, 'motion.json',manifest.assets?.motion),
    motionData(base, 'canopies.json',manifest.assets?.canopies).catch((error) => {
      console.warn('Tree motion is unavailable.', error);
      return [];
    }),
    motionData(base, 'river-flow.json',manifest.assets?.riverFlow).catch((error) => {
      console.warn('Mapped water direction is unavailable.', error);
      return {samples: []};
    }),
  ]);
  const trees = spatialIndex(crowns);
  const waterways = spatialIndex(flow.samples);
  const fountains=spatialIndex(data.fountains ?? []);
  const tracks = data.tracks.map(({points,controls=[]},index)=>({
    points,index,box:trackBounds(points),profile:routeProfile(points,controls,data.step,index),
  }));
  const paintEnvironment = environmentPainter(probe);
  const trams=[];

  return function paint(context, frame, timeMs) {
    if (frame.zoom < LIFE_MIN_ZOOM || frame.width < 1 || frame.height < 1) return false;
    if (!worldRequested && frame.scene && frame.zoom>=STREET_LIFE_ZOOM) {
      worldRequested=true;
      if (probe) probe.world={state:'loading',suppressed:'checking world revisions'};
      loadDynamicWorld(base,manifest,probe).then(paint=>{paintWorld=paint;}).catch(error=>{
        if (probe) probe.world={...probe.world,state:'failed',suppressed:error.message};
        console.warn('Street and sky motion is unavailable.',error);
      });
    }
    const box = bounds(frame, 34);
    const seconds = timeMs / 1000;
    context.save();
    const pad=environmentPadding(frame);
    paintEnvironment(context, frame, () => within(trees,bounds(frame,pad+34)),
      () => within(waterways,bounds(frame,pad+108*frame.zoom)),
      () => within(fountains,bounds(frame,pad)),seconds);
    collectTrams(trams,box,tracks,data.step,seconds);
    if (paintWorld) paintWorld(context,frame,seconds,box,()=>within(trees,box),trams,paintTram);
    else for (const tram of trams) paintTram(context,frame,tram);
    context.restore();
    return true;
  };
}
