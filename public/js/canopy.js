import { windArrival, windGust } from './wind.js';

const poseCount = 13;
const maxCrowns = 66;
const trunkPigment = 0xff445666;
const backSwing = .68;
const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const smooth = (v) => v*v*(3-2*v);
const channel = (color, shift) => (color >>> shift) & 255;

function leafPigment(color) {
  const r=channel(color,0), g=channel(color,8), b=channel(color,16);
  return g>=r-1 && g>b+17 && g<164;
}

function candidates(records, scene, frame, ratio) {
  const found=[];
  for (const [wx,wy,radius,seed,pine] of records) {
    const x=(frame.origin[0]+wx*frame.zoom)*ratio;
    const y=(frame.origin[1]+wy*frame.zoom)*ratio;
    const r=radius*frame.zoom*ratio;
    if (r<2.7*ratio) continue;
    const bend=Math.min((frame.diagnostic ? 19 : 16.4)*ratio,r*(pine ? .99 : 1.35));
    const left=Math.floor(x-1.31*r-bend*backSwing), right=Math.ceil(x+1.14*r+bend);
    const top=Math.floor(y-(pine?3.52:2.91)*r), bottom=Math.ceil(y-.44*r);
    if (left<0 || right>scene.width || top<0 || bottom>scene.height) continue;
    const row=Math.floor(y-(pine?2.09:1.48)*r);
    if (![-.4,0,.4].some(dx=>leafPigment(scene.pixels[row*scene.width+Math.round(x+dx*r)]))) continue;
    found.push({wx,wy,x,y,r,seed,pine,bend,left,top,width:right-left,height:bottom-top});
  }
  found.sort((a,b)=>b.r-a.r);
  const selected=[];
  for (const entry of found) {
    if (selected.length===maxCrowns) break;
    const overlaps=selected.some(other=>{
      const w=Math.min(entry.left+entry.width,other.left+other.width)-Math.max(entry.left,other.left);
      const h=Math.min(entry.top+entry.height,other.top+other.height)-Math.max(entry.top,other.top);
      return w>0 && h>0 && w*h > entry.width*entry.height*.2;
    });
    if (!overlaps) selected.push(entry);
  }
  return selected;
}

function pack(choices, canvas) {
  const width=1280;
  let x=0, y=0, row=0;
  const packed=[];
  for (const crown of choices) {
    const attempts=[];
    for (let i=0;i<poseCount;i++) {
      if (x+crown.width>width) { x=0; y+=row; row=0; }
      if (y+crown.height>1800) break;
      attempts.push([x,y]);
      x+=crown.width;
      row=Math.max(row,crown.height);
    }
    if (attempts.length!==poseCount) break;
    packed.push({...crown,poses:attempts});
  }
  if (packed.length) {
    canvas.width=width;
    canvas.height=y+row;
  }
  return packed;
}

function leafSpan(row, r, pine) {
  const origin=pine?-1.95:-1.45;
  // The four lobes are the footprint of the painted tree in the tile renderer.
  const lobes=[
    [0,origin+.18,1.06,.89],
    [-.47,origin-.14,.75,.67],
    [.32,origin-.22,.64,.60],
    [-.14,origin-(pine?.75:.47),pine?.48:.70,.65],
  ];
  let left=Infinity, right=-Infinity;
  for (const [x,y,rx,ry] of lobes) {
    const v=(row/r-y)/ry;
    if (Math.abs(v)>=1) continue;
    const half=rx*Math.sqrt(1-v*v);
    left=Math.min(left,(x-half)*r);
    right=Math.max(right,(x+half)*r);
  }
  return [left,right];
}

function background(a,b,t) {
  const blend=(shift)=>Math.round(channel(a,shift)*(1-t)+channel(b,shift)*t);
  return ((255<<24)|(blend(16)<<16)|(blend(8)<<8)|blend(0))>>>0;
}

function trunkAnchors(records, scene, frame, ratio) {
  const anchored=new Uint8Array(scene.width*scene.height);
  const half=(.84*frame.zoom+1.2)*ratio;
  for (const [wx,wy,radius] of records) {
    const x=(frame.origin[0]+wx*frame.zoom)*ratio;
    const y=(frame.origin[1]+wy*frame.zoom)*ratio;
    const r=radius*frame.zoom*ratio;
    const left=Math.max(0,Math.floor(x-half));
    const right=Math.min(scene.width,Math.ceil(x+half));
    const top=Math.max(0,Math.floor(y-r*.73-ratio));
    const bottom=Math.min(scene.height,Math.ceil(y+r*.21+ratio));
    if (right<=left || bottom<=top) continue;
    for (let row=top;row<bottom;row++) anchored.fill(1,row*scene.width+left,row*scene.width+right);
  }
  return anchored;
}

export function canopyAtlas(records, scene, frame, ratio, canvas, context) {
  const crowns=pack(candidates(records,scene,frame,ratio),canvas);
  if (!crowns.length) return [];
  const anchors=trunkAnchors(records,scene,frame,ratio);
  const bitmap=context.createImageData(canvas.width,canvas.height);
  const layers=new Uint32Array(bitmap.data.buffer);
  for (const crown of crowns) {
    const {x,y,r,pine,bend,left,top,width,height,poses}=crown;
    const knee=y-r*.62;
    const bases=poses.map(([ax,ay])=>ay*canvas.width+ax);
    const swatches=new Uint32Array(poseCount);
    const leaves=new Uint8Array(width);
    for (let row=1; row<height-1; row++) {
      const absolute=top+row+.5;
      const amount=clamp((knee-absolute)/(r*(pine?1.96:1.62)),0,1);
      // The lower branches taper to zero at the crown's attachment.
      const flex=bend*smooth(amount)*(pine ? 1 : .84+amount*.16);
      if (flex<.5) continue;
      const index=(top+row)*scene.width+left;
      const [l,h]=leafSpan(absolute-y,r,pine);
      const start=Math.max(1,Math.ceil(x+l-left-.5));
      const end=Math.min(width-2,Math.floor(x+h-left-.5));
      if (start>end) continue;
      leaves.fill(0);
      let first=width,last=-1;
      for (let col=start;col<=end;col++) {
        if (!leafPigment(scene.pixels[index+col])) continue;
        leaves[col]=1;
        first=Math.min(first,col);
        last=col;
      }
      if (last<first) continue;
      let before=first-1, after=last+1;
      while (before>0 && scene.pixels[index+before]===trunkPigment) before--;
      while (after<width-1 && scene.pixels[index+after]===trunkPigment) after++;
      const a=scene.pixels[index+before], b=scene.pixels[index+after];
      const lo=Math.max(1,first-Math.ceil(flex*backSwing));
      const hi=Math.min(width-2,last+Math.ceil(flex));
      const range=Math.max(1,last-first);
      for (let col=lo; col<=hi; col++) {
        const original=scene.pixels[index+col];
        if (anchors[index+col] || original===trunkPigment) continue;
        const uncovered=leaves[col] ? background(a,b,(col-first)/range) : original;
        let changed=false;
        for (let pose=0;pose<poseCount;pose++) {
          const displacement=Math.round((pose*(1+backSwing)/(poseCount-1)-backSwing)*flex);
          const sample=col-displacement;
          const color=leaves[sample] ? scene.pixels[index+sample] : uncovered;
          swatches[pose]=color;
          changed ||= color!==original;
        }
        if (changed) for(let pose=0;pose<poseCount;pose++) {
          layers[bases[pose]+row*canvas.width+col]=swatches[pose];
        }
      }
    }
  }
  context.putImageData(bitmap,0,0);
  return crowns.map(({wx,wy,seed,left,top,width,height,poses})=>({wx,wy,seed,left,top,width,height,poses}));
}

export function paintCanopies(context,atlas,crowns,ratio,seconds,opacity=1) {
  context.imageSmoothingEnabled=false;
  for (const {wx,wy,seed,left,top,width,height,poses} of crowns) {
    const arrival=windArrival(wx,wy,seed,seconds);
    const swell=Math.sin(arrival*1.19);
    const gust=windGust(arrival,swell);
    const recoil=Math.sin(arrival*1.79-.93)*(.15+gust*.13);
    const flutter=Math.sin(seconds*(2.7+seed%7*.073)+seed*.25)*(.037+gust*.09);
    const wind=clamp((swell*.48+gust*.71+recoil+flutter)*(.92+seed%7*.025)-.08,-backSwing,1);
    const value=(wind+backSwing)*(poseCount-1)/(1+backSwing);
    const pose=Math.floor(value), blend=value-pose;
    const [x,y]=poses[pose];
    const dx=left/ratio, dy=top/ratio, w=width/ratio, h=height/ratio;
    context.globalAlpha=opacity;
    context.drawImage(atlas,x,y,width,height,dx,dy,w,h);
    if (blend>.045 && pose+1<poses.length) {
      const [nextX,nextY]=poses[pose+1];
      context.globalAlpha=opacity*blend;
      context.drawImage(atlas,nextX,nextY,width,height,dx,dy,w,h);
    }
  }
  context.globalAlpha=1;
}

