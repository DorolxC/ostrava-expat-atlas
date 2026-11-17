import { project, toGeographic, northScreenAngle } from './geo.js';
import { LIFE_MIN_ZOOM, loadLife } from './life.js';

const START = [18.29136,49.83625];
const MAX_ZOOM = 6.3;
const TILE_CONCURRENCY = 12;
const PREFETCH_CONCURRENCY = 2;
const TILE_RETRY_DELAYS = [450, 1000, 2200];
const TILE_TIMEOUT = 8000;
const FRAME_INTERVAL = 1000/25;
const TILE_TRANSITION = 150;
const clamp = (value,min,max)=>Math.min(max,Math.max(min,value));
const lerp = (a,b,t)=>a+(b-a)*t;
const scaleBetween = (a,b,t)=>a*(b/a)**t;
const easing = (t)=>t*t*(3-2*t);
const easeOut = (t)=>1-(1-t)**3;
const travelEase = (t)=>t*t*t*(10+t*(-15+6*t));

function tileRows(tiles) {
  const rows=new Map();
  for (const tile of tiles) {
    if (!rows.has(tile.y)) rows.set(tile.y,{top:tile.y,bottom:tile.y+tile.h,tiles:[]});
    rows.get(tile.y).tiles.push(tile);
  }
  return [...rows.values()].sort((a,b)=>a.top-b.top).map(row=>{
    row.tiles.sort((a,b)=>a.x-b.x);
    return row;
  });
}

async function loadImage(url, timeout = 0, preferBitmap = false) {
  const controller=new AbortController();
  let timer, image, objectUrl;
  const decoded=(async()=>{
    const response=await fetch(url,{signal:controller.signal});
    if (!response.ok) throw new Error('Map image is unavailable');
    const blob=await response.blob();
    controller.signal.throwIfAborted();
    if (preferBitmap && typeof createImageBitmap==='function') {
      // Commit decoded pixels before entering drawScenery. An HTML image can
      // still decode lazily on its first Canvas draw after image.decode().
      const bitmap=await createImageBitmap(blob).catch(()=>null);
      if (controller.signal.aborted) {
        bitmap?.close();
        controller.signal.throwIfAborted();
      }
      if (bitmap) return {image:bitmap,blob};
    }
    objectUrl=URL.createObjectURL(blob);
    image=new Image();
    image.decoding='async';
    image.dataset.mapUrl=url.href;
    image.src=objectUrl;
    await image.decode();
    return {image,blob};
  })();
  try {
    if (!timeout) return await decoded;
    return await Promise.race([decoded,new Promise((_,reject)=>{
      timer=setTimeout(()=>{
        controller.abort();
        image?.removeAttribute('src');
        reject(new Error('Map tile timed out'));
      },timeout);
    })]);
  } finally {
    clearTimeout(timer);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export async function setupViewer(canvas,input,{onFrame,onChange,onLifeState,onResize}) {
  const base=new URL('../map/',import.meta.url);
  const [manifest,overview]=await Promise.all([
    fetch(new URL('scene.json',base),{cache:'no-cache'}).then((result)=>{
      if (!result.ok) throw new Error('Map manifest is unavailable');
      return result.json();
    }),
    loadImage(new URL('overview.png',base)),
  ]);
  overview.image.alt='';
  document.querySelector('#inset-picture img')?.replaceWith(overview.image);
  const context=canvas.getContext('2d',{alpha:false});
  if (!context) throw new Error('Map canvas is unavailable');
  const lifeCanvas=document.createElement('canvas');
  lifeCanvas.id='map-life';
  lifeCanvas.setAttribute('aria-hidden','true');
  canvas.after(lifeCanvas);
  const lifeContext=lifeCanvas.getContext('2d');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const desktop=matchMedia('(min-width:681px)');
  const [west,south,east,north]=manifest.bounds;
  const city=manifest.city;
  const levels=[manifest,...(manifest.closeups??[])].map((layer,index)=>({
    ...layer,threshold:layer.minZoom??(index===0 ? .25 : .95),active:false,opacity:0,
    transition:null,rows:tileRows(layer.tiles),
  }));
  const tiles=new Map();
  const pointers=new Map();
  let gesture;
  let mode='home';
  let w=1;
  let h=1;
  let dpr=1;
  let camera;
  let movement;
  let raf=0;
  let dirty=true;
  let waiting=0;
  let prefetching=0;
  let retryTimer;
  let retryDeadline=Infinity;
  let changeTimer;
  let frameState;
  let tileBlending=false;
  let lifeVisible=true;
  let lifeEnabled=false;
  let lifeLoading;
  let lifePainter;
  let lifePainted=false;
  let nextLifeAt=0;
  let lifeTime=0;
  let lastLifePaint;

  function cityView() {
    const width=w/(city.right-city.left+1780);
    const height=Math.max(h*.66,h-115)/(city.bottom-city.top+1260);
    return {x:(city.left+city.right)/2,y:(city.top+city.bottom)/2,zoom:Math.min(width,height)*.98};
  }
  const minZoom=()=>Math.max(.008,cityView().zoom*.76);
  const limit=(z)=>clamp(z,minZoom(),MAX_ZOOM);

  function home() {
    const [x,y]=project(...START);
    const zoom=desktop.matches ? clamp(Math.min(w/805,h/485),.92,1.84) : clamp(w/277,1.04,1.59);
    return {x,y,zoom};
  }
  function bounded(view) {
    const [lon,lat]=toGeographic(view.x,view.y);
    const [x,y]=project(clamp(lon,west,east),clamp(lat,south,north));
    return {x,y,zoom:limit(view.zoom)};
  }
  function pointOnScreen([x,y],view=camera) {
    return [(x-view.x)*view.zoom+w/2,(y-view.y)*view.zoom+h/2];
  }
  function worldAt(x,y,view=camera) {
    return [view.x+(x-w/2)/view.zoom,view.y+(y-h/2)/view.zoom];
  }
  function anchor(origin,x,y,zoom) {
    return bounded({x:origin[0]-(x-w/2)/zoom,y:origin[1]-(y-h/2)/zoom,zoom});
  }

  function requestFrame() {
    if (!raf && !document.hidden) raf=requestAnimationFrame(draw);
  }
  function requestDraw() {
    dirty=true;
    requestFrame();
  }
  function notifyCamera() {
    clearTimeout(changeTimer);
    changeTimer=setTimeout(()=>onChange?.(),115);
  }

  function resize() {
    const size=canvas.getBoundingClientRect();
    const ratio=Math.min(devicePixelRatio||1,2);
    if (w===size.width && h===size.height && ratio===dpr) return;
    w=Math.max(1,size.width);
    h=Math.max(1,size.height);
    dpr=ratio;
    canvas.width=Math.round(w*dpr);
    canvas.height=Math.round(h*dpr);
    context.setTransform(dpr,0,0,dpr,0,0);
    lifeCanvas.width=canvas.width;
    lifeCanvas.height=canvas.height;
    lifeContext?.setTransform(dpr,0,0,dpr,0,0);
    if (!movement && mode==='home') camera=home();
    if (!movement && mode==='city') camera=cityView();
    onResize?.();
    requestDraw();
  }

  function tileImage(tile,now,visible) {
    let state=tiles.get(tile.name);
    if (state) {
      state.used=now;
      if (state.image || state.pending || !visible || state.retryAt>now) return state.image;
    }
    if (visible ? waiting-prefetching>=TILE_CONCURRENCY : prefetching>=PREFETCH_CONCURRENCY) return null;
    if (!state) {
      state={used:now,image:null,attempts:0,retryAt:0,failed:false,pending:false};
      tiles.set(tile.name,state);
    }
    state.pending=true;
    state.attempts++;
    waiting++;
    if (!visible) prefetching++;
    const url=new URL(tile.name,base);
    if (manifest.tileRevision) url.searchParams.set('v',manifest.tileRevision);
    loadImage(url,TILE_TIMEOUT,true).then(({image,blob})=>{
      state.image=image;
      state.blob=blob;
      state.failed=false;
      state.arrived=performance.now();
    }).catch(()=>{
      state.failed=true;
      state.retryAt=performance.now()+(TILE_RETRY_DELAYS[state.attempts-1]??Infinity);
    }).finally(()=>{
      state.pending=false;
      waiting--;
      if (!visible) prefetching--;
      requestDraw();
    });
    return null;
  }

  function scheduleRetry(at) {
    if (at===retryDeadline) return;
    clearTimeout(retryTimer);
    retryDeadline=at;
    if (Number.isFinite(at)) {
      retryTimer=setTimeout(()=>{
        retryDeadline=Infinity;
        requestDraw();
      },Math.max(0,at-performance.now())+1);
    }
  }

  function coverage(layer,view,margin=0) {
    const [ox,oy]=pointOnScreen([layer.ox/layer.scale,layer.oy/layer.scale],view);
    const factor=view.zoom/layer.scale;
    const visible=[];
    for (const row of layer.rows) {
      const y=oy+row.top*factor;
      if (y>=h+margin) break;
      const bottom=oy+row.bottom*factor;
      if (bottom<=-margin) continue;
      for (const tile of row.tiles) {
        const x=ox+tile.x*factor;
        if (x>=w+margin) break;
        const right=x+tile.w*factor;
        if (right>-margin) visible.push({tile,x,y,right,bottom});
      }
    }
    return visible;
  }

  function fade(layer,target,now) {
    if (reduced.matches) {
      layer.opacity=target;
      layer.transition=null;
      return;
    }
    if ((!layer.transition && layer.opacity!==target) || (layer.transition && layer.transition.to!==target)) {
      layer.transition={from:layer.opacity,to:target,start:now};
    }
    if (!layer.transition) return;
    const {from,to,start}=layer.transition;
    const progress=clamp((now-start)/TILE_TRANSITION,0,1);
    layer.opacity=lerp(from,to,easing(progress));
    if (progress===1) layer.transition=null;
  }

  function drawScenery(now) {
    const [sx,sy]=pointOnScreen([manifest.ox/manifest.scale,manifest.oy/manifest.scale]);
    const factor=camera.zoom/manifest.scale;
    const background=manifest.background??'#dcdfce';
    const overviewRect=[sx,sy,manifest.width*factor,manifest.height*factor];
    context.fillStyle=background;
    context.fillRect(0,0,w,h);
    context.imageSmoothingEnabled=camera.zoom<.16;
    context.drawImage(overview.image,...overviewRect);
    tileBlending=false;
    const resting=!movement && !pointers.size;
    const painted=resting ? [{id:'overview',blob:overview.blob,rect:overviewRect,smooth:context.imageSmoothingEnabled}] : null;
    let settled=true;
    let retryAt=Infinity;
    const snap=(value)=>Math.round(value*dpr)/dpr;
    for (const layer of levels) {
      const hysteresis=layer.threshold*.065;
      layer.active=camera.zoom>=(layer.active ? layer.threshold-hysteresis : layer.threshold);
      if (!layer.active && !layer.opacity) continue;
      const visible=coverage(layer,camera);
      const draws=visible.map((entry)=>({
        ...entry,image:layer.active ? tileImage(entry.tile,now,true) : tiles.get(entry.tile.name)?.image,
      }));
      for (const {tile,image} of draws) {
        if (!layer.active || image) continue;
        const state=tiles.get(tile.name);
        if (!state?.failed) settled=false;
        if (state?.failed && !state.pending && state.retryAt>now) retryAt=Math.min(retryAt,state.retryAt);
      }
      // Commit a new level only after its visible tiles are decoded. The
      // lower level stays painted underneath throughout the fade.
      const ready=draws.length>0 && draws.every(({image,tile})=>image || tiles.get(tile.name)?.failed);
      fade(layer,layer.active && visible.length && (ready || layer.opacity>0) ? 1 : 0,now);
      if (layer.opacity<=0) continue;
      context.imageSmoothingEnabled=camera.zoom*dpr/layer.scale < .72;
      for (const {tile,image,x,y,right,bottom} of draws) {
        if (!image) continue;
        const arrival=tiles.get(tile.name)?.arrived ?? now;
        const arrivalAlpha=reduced.matches || layer.transition ? 1 : clamp((now-arrival)/120,0,1);
        if (arrivalAlpha<1) tileBlending=true;
        context.globalAlpha=layer.opacity*easing(arrivalAlpha);
        const rect=[snap(x),snap(y),snap(right)-snap(x),snap(bottom)-snap(y)];
        context.drawImage(image,...rect);
        painted?.push({id:tile.name,blob:tiles.get(tile.name).blob,rect,smooth:context.imageSmoothingEnabled});
      }
    }
    context.globalAlpha=1;
    scheduleRetry(retryAt);
    const destination=movement?.to??camera;
    for (const layer of levels) {
      if (prefetching>=PREFETCH_CONCURRENCY || destination.zoom<layer.threshold*.89) break;
      const candidates=coverage(layer,destination,42);
      for (const {tile} of candidates) {
        if (prefetching>=PREFETCH_CONCURRENCY) break;
        tileImage(tile,now,false);
      }
    }
    const tileLimit=desktop.matches ? 64 : 36;
    if (tiles.size>tileLimit) {
      for (const [key,value] of tiles) {
        if (tiles.size<=tileLimit) break;
        if (now-value.used>1600 && !value.pending) {
          value.image?.close?.();
          tiles.delete(key);
        }
      }
    }
    if (painted && settled && !tileBlending && !levels.some((level)=>level.transition)) {
      return {key:[w,h,dpr,camera.x,camera.y,camera.zoom,...painted.map(({id})=>id)].join(','), painted, background};
    }
  }

  function advance(now) {
    if (!movement) return;
    const t=clamp((now-movement.start)/movement.length,0,1);
    const {from,to}=movement;
    if (t===1) {
      camera=to;
      movement=null;
      notifyCamera();
    } else if (movement.anchor) {
      const {origin,x,y}=movement.anchor;
      camera=anchor(origin,x,y,scaleBetween(from.zoom,to.zoom,easeOut(t)));
    } else {
      const progress=movement.direct ? easing(t) : travelEase(t);
      const leg=scaleBetween(from.zoom,to.zoom,progress);
      // One continuous zoom envelope through a longer flight.
      const zoom=movement.vista===undefined ? leg : limit(leg*movement.vista**(Math.sin(Math.PI*progress)**2));
      camera={x:lerp(from.x,to.x,progress),y:lerp(from.y,to.y,progress),zoom};
    }
    dirty=true;
  }

  function clearLife() {
    if (lifePainted) lifeContext.clearRect(0,0,w,h);
    lifePainted=false;
  }
  function ambientReady() {
    return lifeContext && lifePainter && lifeEnabled && lifeVisible && !document.hidden &&
      camera.zoom>=LIFE_MIN_ZOOM;
  }
  function draw(now) {
    raf=0;
    advance(now);
    let cameraChanged=false;
    if (dirty || tileBlending || levels.some((level)=>level.transition)) {
      dirty=false;
      const scene=drawScenery(now);
      const origin=pointOnScreen([0,0]);
      cameraChanged=!frameState || w!==frameState.width || h!==frameState.height || dpr!==frameState.dpr ||
        camera.zoom!==frameState.zoom || origin[0]!==frameState.origin[0] || origin[1]!==frameState.origin[1];
      frameState={
        width:w,height:h,dpr,zoom:camera.zoom,origin,pointOnScreen,center:toGeographic(camera.x,camera.y),
        coverage:[city.left,city.top,city.right,city.bottom],
        mapCanvas:canvas,scene,
        inset:{
          left:(camera.x-w/(2*camera.zoom)-manifest.ox/manifest.scale)*manifest.scale/manifest.width,
          top:(camera.y-h/(2*camera.zoom)-manifest.oy/manifest.scale)*manifest.scale/manifest.height,
          width:w/camera.zoom*manifest.scale/manifest.width,
          height:h/camera.zoom*manifest.scale/manifest.height,
        },
        scaleInPixels:(meters)=>meters*camera.zoom,
        canZoomIn:camera.zoom<MAX_ZOOM-.002,canZoomOut:camera.zoom>minZoom()+.002,
      };
      onFrame?.(frameState);
    }
    if (!ambientReady()) {
      clearLife();
      nextLifeAt=0;
      lastLifePaint=undefined;
    } else if (cameraChanged || now>=nextLifeAt) {
      clearLife();
      try {
        if (lastLifePaint!==undefined) lifeTime+=Math.min(110,now-lastLifePaint);
        lastLifePaint=now;
        lifePainted=lifePainter(lifeContext,frameState,lifeTime);
        if (now>=nextLifeAt) {
          nextLifeAt=nextLifeAt>0 ? now+FRAME_INTERVAL-(now-nextLifeAt)%FRAME_INTERVAL : now+FRAME_INTERVAL;
        }
      } catch (error) {
        lifeContext.clearRect(0,0,w,h);
        lifePainter=null;
        onLifeState?.('unavailable');
        console.warn('Ambient movement could not be drawn.',error);
      }
    }
    if (movement || tileBlending || levels.some((level)=>level.transition) || ambientReady()) requestFrame();
  }

  function setLife(enabled) {
    lifeEnabled=enabled;
    if (!enabled) {
      clearLife();
      lastLifePaint=undefined;
      return;
    }
    if (!lifeContext) {
      onLifeState?.('unavailable');
      return;
    }
    if (lifePainter) {
      onLifeState?.('ready');
      requestFrame();
      return;
    }
    if (lifeLoading) return;
    onLifeState?.('loading');
    lifeLoading=loadLife(base,manifest.tileRevision).then((painter)=>{
      lifePainter=painter;
      onLifeState?.('ready');
      requestFrame();
    }).catch((error)=>{
      onLifeState?.('unavailable');
      console.warn('Ambient movement is unavailable.',error);
    }).finally(()=>{ lifeLoading=undefined; });
  }

  function fly(next,type='travel',zoomAnchor) {
    const now=performance.now();
    advance(now);
    const to=bounded(next);
    clearTimeout(changeTimer);
    const distance=Math.hypot(camera.x-to.x,camera.y-to.y);
    if (reduced.matches || (distance<.018 && Math.abs(camera.zoom-to.zoom)<.0005)) {
      camera=to;
      movement=null;
      notifyCamera();
    } else {
      const direct=type!=='travel';
      const length=type==='zoom' ? 183 : type==='keyboard' ? 230 : clamp(510+Math.sqrt(distance)*8,510,1040);
      const vista=!direct && distance*Math.min(camera.zoom,to.zoom)>w*1.3
        ? limit(Math.min(camera.zoom,to.zoom,w*.73/distance))/Math.sqrt(camera.zoom*to.zoom) : undefined;
      movement={from:camera,to,start:now,length,vista,direct,anchor:zoomAnchor};
    }
    requestDraw();
  }

  function zoomBy(factor,x=w/2,y=h/2) {
    const now=performance.now();
    advance(now);
    const currentTarget=movement?.anchor ? movement.to.zoom : camera.zoom;
    const origin=worldAt(x,y);
    const goal=limit(currentTarget*factor);
    mode='custom';
    fly(anchor(origin,x,y,goal),'zoom',{origin,x,y});
  }
  function fit(points) {
    const xs=points.map(([x])=>x);
    const ys=points.map(([,y])=>y);
    const left=Math.min(...xs);
    const right=Math.max(...xs);
    const top=Math.min(...ys);
    const bottom=Math.max(...ys);
    const fitZoom=Math.min((w-120)/Math.max(1,right-left),(h-140)/Math.max(1,bottom-top));
    mode='custom';
    fly({x:(left+right)/2,y:(top+bottom)/2,zoom:Math.min(MAX_ZOOM,Math.max(camera.zoom*1.5,1.05),Math.max(camera.zoom,fitZoom))});
  }
  function select(point,id,area) {
    mode='custom';
    const maxDefault=id==='bolt-tower' ? 2.68 : 1.96;
    const zoom=Math.max(camera.zoom,desktop.matches ? maxDefault : maxDefault*.81);
    fly(placeView(point,area,zoom));
  }
  function placeView(point,{left,right,top,bottom,verticalFocus=.5},zoom) {
    return anchor(point,(left+right)/2,lerp(top,bottom,verticalFocus)+18,zoom);
  }
  function revealPlace(point,area) {
    const [x,y]=pointOnScreen(point,movement?.to??camera);
    if (x>=area.left && x<=area.right && y>=area.top+42 && y<=area.bottom) return;
    mode='custom';
    camera=placeView(point,area,camera.zoom);
    movement=null;
    requestDraw();
    notifyCamera();
  }
  function reset() { mode='home'; fly(home()); }
  function wholeCity() { mode='city'; fly(cityView()); }
  function goToDistrict(coords) {
    const [x,y]=project(...coords);
    mode='custom';
    fly({x,y,zoom:desktop.matches ? .78 : .52});
  }
  function goFromInset(x,y) {
    mode='custom';
    fly({x:(manifest.ox+x*manifest.width)/manifest.scale,y:(manifest.oy+y*manifest.height)/manifest.scale,zoom:clamp(camera.zoom,.49,1.65)});
  }
  function parseView(text) {
    if (!text) return;
    const [lon,lat,zoom,...other]=text.split(',').map(Number);
    if (other.length || ![lon,lat,zoom].every(Number.isFinite) || zoom<=0 ||
      lon<west-.001 || lon>east+.001 || lat<south-.001 || lat>north+.001) return;
    const [x,y]=project(lon,lat);
    return bounded({x,y,zoom});
  }
  function travelToView(text) {
    const target=parseView(text);
    if (!target) return;
    mode='custom';
    fly(target);
  }
  function loadView(text) {
    const target=parseView(text);
    if (!target) return false;
    mode='custom';
    movement=null;
    camera=target;
    requestDraw();
    return true;
  }
  function view() {
    const [lon,lat]=toGeographic(camera.x,camera.y);
    return [lon.toFixed(6),lat.toFixed(6),camera.zoom.toFixed(3)].join(',');
  }

  function position(event) {
    const bounds=input.getBoundingClientRect();
    return {x:event.clientX-bounds.left,y:event.clientY-bounds.top};
  }
  function gestureState() {
    const [a,b]=pointers.values();
    if (!a) return null;
    if (!b) return {...a,span:0};
    return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,span:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))};
  }

  input.addEventListener('pointerdown',(event)=>{
    if (event.button!==0) return;
    input.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId,position(event));
    advance(performance.now());
    movement=null;
    gesture=gestureState();
    requestDraw();
  });
  input.addEventListener('pointermove',(event)=>{
    if (!gesture || !pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId,position(event));
    const next=gestureState();
    const factor=next.span && gesture.span ? next.span/gesture.span : 1;
    camera=anchor(worldAt(gesture.x,gesture.y),next.x,next.y,limit(camera.zoom*factor));
    gesture=next;
    mode='custom';
    requestDraw();
  });
  function release(event) {
    if (!pointers.delete(event.pointerId)) return;
    gesture=gestureState();
    if (!gesture) notifyCamera();
    requestDraw();
  }
  input.addEventListener('pointerup',release);
  input.addEventListener('pointercancel',release);
  input.addEventListener('lostpointercapture',release);
  input.parentElement.addEventListener('wheel',(event)=>{
    if (event.target!==input && !event.target.closest('#markers button')) return;
    event.preventDefault();
    const {x,y}=position(event);
    const unit=event.deltaMode===1 ? 16 : event.deltaMode===2 ? h : 1;
    zoomBy(Math.exp(-clamp(event.deltaY*unit,-168,168)*.00235),x,y);
  },{passive:false});
  input.addEventListener('keydown',(event)=>{
    const offsets={ArrowLeft:[-100,0],ArrowRight:[100,0],ArrowUp:[0,-100],ArrowDown:[0,100]};
    if (offsets[event.key]) {
      event.preventDefault();
      mode='custom';
      const [x,y]=offsets[event.key];
      const origin=movement?.to??camera;
      fly({x:origin.x+x/camera.zoom,y:origin.y+y/camera.zoom,zoom:camera.zoom},'keyboard');
    } else if (['+','=','-','0'].includes(event.key)) {
      event.preventDefault();
      if (event.key==='0') reset();
      else zoomBy(event.key==='-' ? 1/1.31 : 1.31);
    }
  });

  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([entry])=>{
    lifeVisible=entry.isIntersecting;
    if (lifeVisible) requestFrame();
    else clearLife();
  }).observe(canvas);
  document.addEventListener('visibilitychange',()=>{
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf=0;
      clearLife();
    } else requestDraw();
  });
  reduced.addEventListener('change',()=>{
    if (reduced.matches && movement) {
      camera=movement.to;
      movement=null;
      notifyCamera();
    }
    requestDraw();
  });
  document.getElementById('compass-arrow').style.transform='rotate('+northScreenAngle+'deg)';
  resize();
  camera=home();
  requestDraw();
  return {requestDraw,zoomBy,fit,reset,wholeCity,goToDistrict,goFromInset,select,revealPlace,view,loadView,travelToView,setLife};
}
