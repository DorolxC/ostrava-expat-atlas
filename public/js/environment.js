import { canopyAtlas, paintCanopies } from './canopy.js';
import { waterSurface, paintWater } from './water.js';

function visibleFountains(image, ratio, {zoom,origin}, fountains) {
  if (zoom<1.9) return [];
  const prepared=[];
  const side=Math.max(1,Math.round(zoom*ratio*.94));
  for (const [wx,wy] of fountains) {
    const x=origin[0]+wx*zoom;
    const y=origin[1]+(wy-.47)*zoom;
    const px=Math.round(x*ratio);
    const py=Math.round(y*ratio);
    if (px<side || py<1 || px>=image.width-side || py>=image.height-1) continue;
    let pool=0;
    for (const dx of [-side,0,side]) {
      const color=image.pixels[py*image.width+px+dx];
      const r=color&255, g=color>>>8&255, b=color>>>16&255;
      if (Math.abs(r-87)<12 && Math.abs(g-127)<12 && Math.abs(b-139)<12) pool++;
    }
    if (pool>=2) prepared.push([x,y,wx*.058+wy*.017]);
  }
  return prepared;
}

function paintFountains(context, fountains, zoom, seconds, opacity) {
  if (!fountains.length) return;
  context.strokeStyle='#c8e6db';
  context.lineWidth=Math.max(.58,zoom*.16);
  for (const [x,y,seed] of fountains) {
    const time=seconds*.71+seed;
    const ripple=time-Math.floor(time);
    context.globalAlpha=opacity*.56*Math.sin(Math.PI*ripple);
    context.beginPath();
    context.ellipse(x,y,(.32+ripple*1.36)*zoom,(.20+ripple*.58)*zoom,0,0,Math.PI*2);
    context.stroke();
    const jet=.53+.25*Math.sin(seconds*4.3+seed);
    context.globalAlpha=opacity*.44;
    context.beginPath();
    context.moveTo(x,y);
    context.quadraticCurveTo(x-zoom*.13,y-jet*zoom,x+zoom*.21,y-(jet+.31)*zoom);
    context.stroke();
  }
  context.globalAlpha=1;
}

export function prepareEnvironment(frame, records, flow, sample, foliage, paintScene, fountains=[]) {
  const read = sample.getContext('2d', {willReadFrequently: true});
  const sprites = foliage.getContext('2d');
  if (!read || !sprites) throw new Error('Environmental canvas is unavailable');
  const ratio = Math.min(frame.pixelRatio, Math.sqrt(2_300_000 / (frame.width * frame.height)));
  sample.width = Math.ceil(frame.width * ratio);
  sample.height = Math.ceil(frame.height * ratio);
  read.setTransform(ratio, 0, 0, ratio, 0, 0);
  paintScene(read);
  const data = read.getImageData(0, 0, sample.width, sample.height);
  const image = {width: data.width, height: data.height, pixels: new Uint32Array(data.data.buffer)};
  return {
    ratio, water:waterSurface(image,ratio,frame,flow),
    trees:canopyAtlas(records,image,frame,ratio,foliage,sprites),
    fountains:visibleFountains(image,ratio,frame,fountains),
  };
}

export const environmentPadding=(frame)=>Math.min(84,Math.round(Math.min(frame.width,frame.height)*.13));

export function environmentPainter() {
  const diagnostic=new URL(location.href).searchParams.get('motion')==='diagnostic';
  const cached = new Map();
  let current, previous, changedAt, pending, worker, sample, unavailableKey;
  let canUseWorker = typeof Worker === 'function' && typeof OffscreenCanvas === 'function';

  function commit(view, {water, trees, ratio, atlas, fountains}) {
    pending = null;
    if (water) {
      const {spans, ribbons} = water;
      const clip = new Path2D();
      for (let i = 0; i < spans.length; i += 3) {
        clip.rect(spans[i] / ratio, spans[i+1] / ratio, spans[i+2] / ratio, 1 / ratio);
      }
      water = {clip, ribbons};
    }
    const prepared = {view, water, trees, ratio, atlas, fountains};
    cached.set(view.key, prepared);
    current ??= prepared;
    if (cached.size > 4) {
      const [oldest,retired] = [...cached].find(([,patch])=>patch!==current && patch!==previous);
      retired.atlas?.close?.();
      cached.delete(oldest);
    }
  }

  function fallBack() {
    canUseWorker = false;
    worker?.terminate();
    worker = null;
    pending = null;
  }

  function prepare(frame, records, flow, fountains) {
    const {scene, zoom, width, height, origin, mapCanvas} = frame;
    const {key, painted, background} = scene;
    const pad=environmentPadding(frame);
    const view = {key, zoom, width:width+2*pad, height:height+2*pad, origin:origin.map(n=>n+pad),
      background, diagnostic, pixelRatio:mapCanvas.width/width};
    if (canUseWorker) {
      try {
        if (!worker) {
          worker = new Worker(new URL('environment-worker.js', import.meta.url), {type: 'module'});
          worker.onerror = fallBack;
          worker.onmessageerror = fallBack;
          worker.onmessage = ({data}) => {
            if (!data) fallBack();
            else if (pending) commit(pending, data);
            else data.atlas?.close();
          };
        }
        pending = view;
        // Share the compressed tile bytes already fetched by the viewer.
        // Decoding and compositing them here would stall the interactive canvas.
        const layers=painted.map(({rect:[x,y,w,h],...layer})=>({...layer,rect:[x+pad,y+pad,w,h]}));
        worker.postMessage({layers, view, records, flow, fountains});
        return;
      } catch {
        fallBack();
      }
    }
    try {
      sample ??= document.createElement('canvas');
      const atlas = document.createElement('canvas');
      const prepared = prepareEnvironment(view, records, flow, sample, atlas, (context) => {
        context.imageSmoothingEnabled = false;
        context.drawImage(mapCanvas, pad, pad, width, height);
      }, fountains);
      commit(view, {...prepared, atlas});
    } catch (error) {
      unavailableKey = key;
      console.warn('Tree and water motion could not prepare this view.', error);
    }
  }

  // Reproject a settled patch into the current camera until its replacement
  // arrives. Both patches sample the same wind and river clocks.
  function transform(view,frame) {
    const scale=frame.zoom/view.zoom;
    const x=frame.origin[0]-view.origin[0]*scale;
    const y=frame.origin[1]-view.origin[1]*scale;
    if (x>=frame.width || y>=frame.height || x+view.width*scale<=0 || y+view.height*scale<=0) return null;
    return [x,y,scale];
  }

  function paintPatch(context,patch,position,seconds,opacity) {
    if (!position || opacity<=0) return;
    const {view,water,trees,ratio,atlas,fountains}=patch;
    const [x,y,scale]=position;
    context.save();
    context.translate(x,y);
    context.scale(scale,scale);
    paintWater(context,water,view.zoom,seconds,view.diagnostic,opacity);
    paintFountains(context,fountains,view.zoom,seconds,opacity);
    paintCanopies(context,atlas,trees,ratio,seconds,opacity);
    context.restore();
  }

  return (context, frame, visibleTrees, nearbyFlow, visiblePools, seconds) => {
    const key = frame.scene?.key;
    if (key) {
      if (!pending && key !== unavailableKey && !cached.has(key)) {
        prepare(frame,Array.from(visibleTrees()),Array.from(nearbyFlow()),Array.from(visiblePools()));
      }
      const exact = cached.get(key);
      if (exact && exact !== current) {
        previous=current;
        current = exact;
        changedAt=seconds;
        cached.delete(key);
        cached.set(key, exact);
      }
    }
    if (!current) return;
    const oldPosition=previous && transform(previous.view,frame);
    const mix=oldPosition ? Math.min(1,(seconds-changedAt)/.16) : 1;
    if (mix<1) paintPatch(context,previous,oldPosition,seconds,1-mix);
    else previous=null;
    paintPatch(context,current,transform(current.view,frame),seconds,mix);
  };
}

