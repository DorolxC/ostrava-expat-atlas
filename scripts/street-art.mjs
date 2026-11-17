import { region } from '../public/js/geo.js';
import { mix, shade } from './raster.mjs';
import { transportGrade } from './transport.mjs';

export function paintStreetDetails({map,scale,features,roads,projectLine,boxRing,grade=0,onlyCrossings=null}) {
  if (scale<1.45) return;
  const details = features('detail');
  const width = map.width;
  const height = map.height;
  const detailAt = (x,y)=>x>=0 && y>=0 && x<width && y<height;
  const dot = (x,y,color)=>map.pixel(Math.round(x),Math.round(y),color);
  const mark = (ring,color)=>map.polygon([ring],color);

  function markCrossing(x,y) {
    let closest;
    let matchDistance = (1.1*scale)**2;
    for (const road of roads) {
      if (!['primary','secondary','tertiary','unclassified','residential','service','living_street'].includes(road.tags.highway)) continue;
      for (const path of road.rings) {
        for (let i=1;i<path.length;i++) {
          const [ax,ay] = path[i-1];
          const [bx,by] = path[i];
          const dx = bx-ax;
          const dy = (by-ay)/region.pitch;
          const length = Math.hypot(dx,dy);
          if (length<1.5*scale || Math.min(ax,bx)>x+7*scale || Math.max(ax,bx)<x-7*scale) continue;
          const t = Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)/region.pitch*dy)/(length*length)));
          const distance = (ax+dx*t-x)**2+((ay-y)/region.pitch+dy*t)**2;
          if (distance>=matchDistance) continue;
          closest={axis:Math.atan2(dy,dx),width:road.size/scale,x:ax+dx*t,y:ay+dy*t*region.pitch};
          matchDistance=distance;
        }
      }
    }
    if (!closest) return;
    const count = Math.max(4,Math.round((closest.width-1.5)/1.1));
    const c = Math.cos(closest.axis);
    const s = Math.sin(closest.axis);
    for (let i=0;i<count;i++) {
      const p = (i-(count-1)/2)*scale*closest.width/count*0.83;
      const ring = boxRing(closest.x-s*p,closest.y+c*p*region.pitch,2.7,0.43,closest.axis);
      mark(ring,0xe5dfc8);
    }
  }

  for (const {rings,tags} of details) {
    const [x,y] = rings[0][0];
    if (!detailAt(x,y)) continue;
    if (tags.kind==='zebra') {
      if (onlyCrossings!==false && grade===transportGrade(tags)) markCrossing(x,y);
      continue;
    }
    if (onlyCrossings===true) continue;
    if (tags.kind==='bench') {
      const angle=-0.44;
      const base = boxRing(x,y,1.75,0.62,angle);
      mark(base,0x6e715b);
      const seat = boxRing(x,y-0.43*scale,1.7,0.53,angle);
      mark(seat,0xa9835d);
      projectLine([[seat[0][0],seat[0][1]-0.28*scale],[seat[1][0],seat[1][1]-0.28*scale]],0.30*scale,0xc6a571);
    }
    if (tags.kind==='fountain') {
      map.ellipse(x,y+0.29*scale,2.5*scale,1.58*scale,(px,py)=>dot(px,py,0x777969));
      map.ellipse(x,y-0.38*scale,2.30*scale,1.37*scale,(px,py,dx,dy)=>dot(px,py,dx+dy<0 ? 0xd8c9a4 : 0xb3ac90));
      map.ellipse(x,y-0.41*scale,1.85*scale,1.05*scale,(px,py,dx,dy)=>{
        dot(px,py,shade(0x577f8b,dx*dx+dy*dy>0.72 ? -8 : 7));
      });
      map.ellipse(x,y-0.62*scale,0.55*scale,0.49*scale,(px,py)=>dot(px,py,0xa4c3be));
    }
    if (tags.kind==='tram-stop') {
      // Mapped stops get a small enamel flag, without inventing a platform footprint.
      const top = y-2.15*scale;
      for (let py=Math.round(top);py<Math.round(y);py++) dot(x,py,0x54666a);
      map.ellipse(x,top,0.44*scale,0.44*scale,(px,py)=>dot(px,py,mix(0xc77a49,0xe1d7a7,0.34)));
    }
  }
}
