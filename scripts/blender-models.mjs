import { readdir, readFile } from 'node:fs/promises';
import { projectMeters, region } from '../public/js/geo.js';
import { noise, shade } from './raster.mjs';

export async function loadBlenderModels() {
  const directory=new URL('./blender/models/',import.meta.url);
  const files=await readdir(directory).catch(error=>{
    if (error.code==='ENOENT') return [];
    throw error;
  });
  return Promise.all(files.filter(file=>/^[a-z][a-z-]+\.json$/.test(file)).sort().map(async file=>{
    const model=JSON.parse(await readFile(new URL(file,directory),'utf8'));
    const mesh=model.vertices.map(([east,north,height])=>[...projectMeters(east,north),height]);
    const reach=mesh.reduce((radius,[x,y,height])=>Math.max(radius,Math.abs(x),Math.abs(y)+height),0);
    return {...model,model:'blender',level:'A',geometry:{buildings:model.replaces},replaces:{buildings:model.replaces},mesh,reach};
  }));
}

export function paintBlenderModel(model,[x,y],scale,triangle) {
  // Keep subpixel vertices identical when the same face crosses two sections.
  const subpixel=value=>Math.round(value*1024)/1024;
  const points=model.mesh.map(([u,v,height])=>[subpixel(x+u*scale),subpixel(y+v*scale),height]);
  const masonry=model.id==='hrad' || model.id==='trojhali' || model.id==='dum-kultury';
  for (const [a,b,c,color] of model.faces) {
    const [p,q,r]=[points[a],points[b],points[c]];
    const flat=Math.max(p[2],q[2],r[2])-Math.min(p[2],q[2],r[2])<.1;
    const red=color>>16;
    const terracotta=red-(color>>8&255)>23;
    function pigment(px,ground,height) {
      const east=(px-x)/scale;
      const north=(ground-y)/(scale*region.pitch);
      const grain=noise(Math.floor(east*1.35),Math.floor(north*1.35+height*.92),291)-.5;
      let tone=grain*(masonry ? 12 : 6);
      if (masonry && terracotta && height>3) {
        const row=(north-height)*1.28;
        const joint=east*.81+Math.floor(row)*.5;
        tone+=(row-Math.floor(row)<.20 ? -8 : 0)+
          (noise(Math.floor(joint),Math.floor(row),393)-.5)*11;
      } else if (masonry && !flat) {
        const row=height*(model.id==='hrad' ? 1.65 : .92);
        const along=east*.62+north*.47+(Math.floor(row)&1)*.5;
        tone+=(row-Math.floor(row)<.18 ? -9 : 0)+
          (noise(Math.floor(along),Math.floor(row),26)-.5)*15;
      } else if (flat && !terracotta && model.id!=='organica') {
        const seam=east*.30+north*.18;
        tone+=(seam-Math.floor(seam)<.10 ? -5 : 0);
      }
      return shade(color,Math.round(tone));
    }
    triangle(p,q,r,color,pigment);
  }
}
