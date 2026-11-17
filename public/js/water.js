import { region } from './geo.js';

const tau = 2 * Math.PI;
const clamp = (v, lo, hi) => Math.max(lo,Math.min(hi,v));
const mix = (a,b,t) => a+(b-a)*t;
const wrap = (value) => value-Math.floor(value);
const channel = (pixel, shift) => (pixel >>> shift) & 255;

function isWater(pixel) {
  const r = channel(pixel, 0);
  const g = channel(pixel, 8);
  const b = channel(pixel, 16);
  return g >= 121 && g <= 151 && Math.abs(g-r-54)<=5 && Math.abs(b-g-14)<=4;
}

function flowNear(samples, x, y, sharesSurface) {
  let best, score=Infinity;
  for (const [u,v,dx,dy,bend,reach,station,group] of samples) {
    const a=x-u, b=(y-v)/region.pitch;
    const d=a*a+b*b;
    const normalized=d/(reach*reach);
    if (normalized>=1 || normalized>=score) continue;
    if (d>30**2 && !sharesSurface(u,v)) continue;
    score=normalized;
    const groundY=dy/region.pitch;
    const downstream=(station ?? u*dx+v/region.pitch*groundY)+a*dx+b*groundY;
    best={dx,dy,bend,downstream,crossStream:b*dx-a*groundY,group:group ?? 0,edge:Math.sqrt(normalized)};
  }
  return best;
}

function seedFor(row, col) {
  return (Math.imul(row + 81, 1376312589) ^ Math.imul(col + 31, 1597334677)) >>> 0;
}

function channelWidth(image, x, y, tx, ty, ratio) {
  const {pixels,width,height}=image;
  let span=0;
  for (const side of [-1,1]) {
    let steps=0;
    for (let delta=3; delta<=60; delta+=3) {
      const px=Math.round((x-side*ty*delta)*ratio);
      const py=Math.round((y+side*tx*delta)*ratio);
      if (px<0 || px>=width || py<0 || py>=height || !isWater(pixels[py*width+px])) break;
      steps=delta;
    }
    span+=steps;
  }
  return span;
}

export function waterSurface({pixels,width,height}, ratio, {zoom,origin}, flow) {
  const spans=[];
  const along=clamp(zoom*30,29,76);
  const across=clamp(zoom*8.2,7,19);
  const rowWidth=Math.ceil(width/ratio/along)+2;
  const firstCol=Math.floor(-origin[0]/along+.5);
  const cells=new Map();
  // Inset the painted water by one sample pixel at banks and bridge edges.
  function openWater(x,y) {
    const i=y*width+x;
    return isWater(pixels[i]) &&
      (x===0 || isWater(pixels[i-1])) && (x===width-1 || isWater(pixels[i+1])) &&
      (y===0 || isWater(pixels[i-width])) && (y===height-1 || isWater(pixels[i+width]));
  }
  for (let y=0; y<height; y++) {
    let start=-1;
    const v=y/ratio;
    const row=Math.floor((v-origin[1])/across);
    for (let x=0; x<=width; x++) {
      if (x<width && openWater(x,y)) {
        if (start<0) start=x;
      } else if (start>=0) {
        spans.push(start,y,x-start);
        const from=start/ratio, to=(x-1)/ratio;
        const first=Math.floor((from-origin[0])/along+.5);
        const last=Math.floor((to-origin[0])/along+.5);
        for (let col=first; col<=last; col++) {
          const key=row*rowWidth+col-firstCol;
          // World-anchored, staggered samples avoid a visible raster grid.
          const seed=seedFor(row,col);
          const centre=origin[0]+(col+(seed%31/30-.5)*.53)*along;
          const target=origin[1]+(row+.14+(seed%73)/72*.72)*across;
          const u=clamp(centre,from,to);
          const score=Math.abs(v-target)+Math.abs(u-centre)*.62;
          if (score < (cells.get(key)?.score ?? Infinity)) cells.set(key,{u,v,seed,score});
        }
        start=-1;
      }
    }
  }
  if (!cells.size) return;

  const ribbons=[];
  for (const {u,v,seed} of cells.values()) {
    const stream=flowNear(flow,(u-origin[0])/zoom,(v-origin[1])/zoom,(x,y)=>{
      // Keep an adjacent pond or a disconnected channel from inheriting a
      // nearby river's direction across a strip of land.
      const endX=origin[0]+x*zoom, endY=origin[1]+y*zoom;
      for (const t of [.24,.49]) {
        const sx=Math.round(mix(u,endX,t)*ratio), sy=Math.round(mix(v,endY,t)*ratio);
        if (sx>=0 && sx<width && sy>=0 && sy<height && !isWater(pixels[sy*width+sx])) return false;
      }
      return true;
    });
    const variety=(seed%101)/100;
    const phase=(seed%199)/199;
    if (!stream) {
      // Lakes and unmapped flow use a short wind riffle with no net drift.
      if (seed%3===0) ribbons.push({u,v,tx:.98,ty:.20,bend:0,reach:2.3,
        length:along*mix(.18,.32,variety),phase,rate:.18+variety*.09,kind:0,body:0});
      continue;
    }
    const speed=Math.hypot(stream.dx,stream.dy);
    const edge=clamp(stream.edge*1.5,0,1);
    const tx=stream.dx/speed, ty=stream.dy/speed;
    const cross=channelWidth({pixels,width,height},u,v,tx,ty,ratio);
    const breadth=clamp((cross-10)/55,0,1);
    const kind=cross<15 || edge>.75 ? 1 : 2;
    const wavelength=58;
    const shift=stream.crossStream*.011+Math.sin(stream.crossStream*.073)*.081;
    const downstreamPhase=wrap(stream.group*.017+shift-stream.downstream/wavelength);
    ribbons.push({
      u,v,tx,ty,bend:stream.bend*.29,
      reach:clamp(zoom*wavelength*speed*mix(.71,1,breadth),19,125),
      length:along*mix(.49,1.02,variety)*mix(.68,1.15,breadth),
      phase:downstreamPhase,rate:mix(.222,.196,edge),kind,body:breadth,
    });
  }
  return {spans:Uint32Array.from(spans),ribbons};
}

export function paintWater(context,surface,zoom,seconds,diagnostic=false,opacity=1) {
  if (!surface?.ribbons.length) return;
  const {clip,ribbons}=surface;
  const shade=new Path2D(), body=new Path2D(), soft=new Path2D(), light=new Path2D();
  const weight=clamp(zoom*.81,1.10,2.25);
  const drift=diagnostic?1.37:1;
  for (const {u,v,tx,ty,bend,reach,length,phase,rate,kind,body:breadth} of ribbons) {
    const count=kind===2 && breadth>.30 ? 2 : 1;
    for (let i=0; i<count; i++) {
      const swell=kind ? Math.sin(seconds*.71+phase*tau)*.022 : 0;
      const travel=wrap(phase+seconds*rate*drift+i*.52+swell);
      const envelope=Math.sin(travel*Math.PI)**1.23;
      if (envelope<.08) continue;
      const at=kind ? (travel-.5)*reach*drift : Math.sin(travel*tau)*reach;
      const cross=bend*at*at/reach+Math.sin(travel*tau+phase*tau)*weight*.49+i*weight*2.45;
      const x=u+tx*at-ty*cross, y=v+ty*at+tx*cross;
      const lengthAt=length*envelope*(i?.63:1);
      const tail=lengthAt*.77, nose=lengthAt*.23;
      const arch=weight*(kind===2?1.14+Math.abs(bend)*1.8:.8);
      const startX=x-tx*tail, startY=y-ty*tail;
      const endX=x+tx*nose, endY=y+ty*nose;
      soft.moveTo(startX,startY);
      soft.quadraticCurveTo(x-ty*arch,y+tx*arch,endX,endY);
      if (!kind) continue;
      // The bright head grows and recedes while the softer tail keeps travelling.
      const crest=lengthAt*(i?.29:.53+breadth*.18);
      light.moveTo(endX-tx*crest,endY-ty*crest);
      light.quadraticCurveTo(endX-tx*crest*.54-ty*arch*.72,endY-ty*crest*.54+tx*arch*.72,endX,endY);
      if (kind===1 || i) continue;
      const lee=weight*(1.65+breadth);
      shade.moveTo(startX-ty*lee,startY+tx*lee);
      shade.quadraticCurveTo(x-ty*(lee+arch),y+tx*(lee+arch),endX-ty*lee,endY+tx*lee);
      const deep=weight*(1.45+breadth*1.65)*envelope;
      body.moveTo(startX,startY);
      body.quadraticCurveTo(x-ty*arch,y+tx*arch,endX,endY);
      body.quadraticCurveTo(x+ty*deep,y-tx*deep,startX,startY);
      body.closePath();
    }
  }
  context.save();
  context.clip(clip);
  context.fillStyle='#78acb1';
  context.globalAlpha=opacity*(diagnostic?.43:.34);
  context.fill(body);
  context.lineWidth=weight*1.28;
  context.strokeStyle='#295666';
  context.globalAlpha=opacity*(diagnostic?.56:.46);
  context.stroke(shade);
  context.strokeStyle='#84bab8';
  context.lineWidth=weight*.93;
  context.globalAlpha=opacity*.55;
  context.stroke(soft);
  context.strokeStyle='#a6d5cc';
  context.lineWidth=weight*.89;
  context.globalAlpha=opacity*(diagnostic?.92:.80);
  context.stroke(light);
  context.restore();
}
