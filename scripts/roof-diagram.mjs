import { basename } from 'node:path';
import { region } from '../public/js/geo.js';

export function drawRoofDiagram(canvas, {footprint,shells}, pitch) {
  const context=canvas.getContext('2d');
  const x=footprint.flat().map(p=>p[0]);
  const y=footprint.flat().map(p=>p[1]/pitch);
  const left=Math.min(...x),right=Math.max(...x),top=Math.min(...y),bottom=Math.max(...y);
  const scale=Math.min((canvas.width-36)/Math.max(1,right-left),(canvas.height-32)/Math.max(1,bottom-top));
  const position=([u,v])=>[canvas.width/2+(u-(left+right)/2)*scale,canvas.height/2+(v/pitch-(top+bottom)/2)*scale];
  const path=(points)=>{
    context.moveTo(...position(points[0]));
    for (const p of points.slice(1)) context.lineTo(...position(p));
    context.closePath();
  };
  if (canvas.dataset.kind==='roof') for (const shell of shells) {
    if (!shell.facets.length) {
      context.beginPath();
      shell.rings.forEach(path);
      context.fillStyle='#b4c2c6';
      context.fill('evenodd');
    }
    for (const face of shell.facets) {
      const [a,b,c]=face;
      const ux=b[0]-a[0],uy=(b[1]-a[1])/pitch;
      const vx=c[0]-a[0],vy=(c[1]-a[1])/pitch;
      const u=b[2]-a[2],v=c[2]-a[2],det=ux*vy-vx*uy;
      const gx=(u*vy-v*uy)/det,gy=(v*ux-u*vx)/det;
      const light=68+22*(gx*.72+gy*.69)/(Math.hypot(gx,gy)||1);
      context.beginPath();
      path(face);
      context.fillStyle=`hsl(29 41% ${Math.round(light)}%)`;
      context.fill();
      context.strokeStyle=context.fillStyle;
      context.stroke();
    }
  }
  context.beginPath();
  footprint.forEach(path);
  if (canvas.dataset.kind==='footprint') {
    context.fillStyle='#bcd0d1';
    context.fill('evenodd');
  }
  context.strokeStyle='#274656';
  context.stroke();
}

export function roofPreview(roof, raster) {
  const png=encodeURIComponent(basename(raster));
  const data=JSON.stringify(roof).replace(/</g,'\\u003c');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Roof inspection · Ostrava Expat Atlas</title>
<style>body{max-width:1060px;margin:28px auto;padding:0 16px;background:#f6eedd;color:#183449;font:15px/1.4 system-ui}figure{margin:0}figcaption{margin-top:5px}img,canvas{display:block;max-width:100%;height:auto;border:1px solid #b9ad95;background:#fcf7ed}section{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:20px}</style>
<h1>Roof inspection</h1><p id="case"></p>
<section><figure><canvas width="506" height="290" data-kind="footprint"></canvas><figcaption>Source footprint</figcaption></figure>
<figure><canvas width="506" height="290" data-kind="roof"></canvas><figcaption>Roof planes</figcaption></figure></section>
<figure><img src="${png}" alt="Isometric map crop"><figcaption>Atlas tile painter</figcaption></figure>
<script id="roof" type="application/json">${data}</script>
<script>const roof=JSON.parse(document.getElementById('roof').textContent);
document.getElementById('case').textContent=roof.id+' · '+roof.shells.map(s=>s.type+(s.reason ? ' · '+s.reason : ' · '+s.height.toFixed(2)+' m rise')).join(' / ');
for(const canvas of document.querySelectorAll('canvas')) (${drawRoofDiagram.toString()})(canvas,roof,${region.pitch});</script></html>`;
}
