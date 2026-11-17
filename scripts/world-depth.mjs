import { region } from '../public/js/geo.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const scale=1.5;
const overlap=Math.ceil(205*scale);
const rise=Math.sqrt(1-region.pitch**2);

export function depthField(draw, bounds, style) {
  const [left,top,right,bottom]=bounds;
  const x=Math.floor(left*scale),y=Math.floor(top*scale);
  const width=Math.ceil(right*scale)-x,height=Math.ceil(bottom*scale)-y;
  const raster=draw(scale,x-overlap,y-overlap,width+overlap*2,height+overlap*2,undefined,undefined,style);
  const runs=[];
  let last=0, count=0;
  for (let row=0;row<height;row++) {
    const start=(row+overlap)*raster.width+overlap;
    for (let column=0;column<width;column++) {
      // The normal map painter stores screen Y plus 1.45 times the projected
      // lift. Quantize the corresponding world-space height to half a metre.
      const front=(raster.depth[start+column]-row-overlap-.5)/(scale*rise*1.45);
      const value=Math.max(0,Math.min(255,Math.round(front*2)));
      if (count && (count===255 || value!==last)) {runs.push(count,last);count=0;}
      last=value;
      count++;
    }
  }
  if (count) runs.push(count,last);
  return {x,y,width,height,scale,rle:Buffer.from(runs).toString('base64')};
}

export async function writeDepthAssets({fields,geometry,tileRevision},destination) {
  await mkdir(new URL('world-depth/',destination),{recursive:true});
  let bytes=0;
  const index=[];
  for (const {rle,...field} of fields) {
    const file='world-depth/'+field.id+'.json.gz';
    const pack=gzipSync(JSON.stringify({id:field.id,tileRevision,rle}),{level:9});
    await writeFile(new URL(file,destination),pack);
    index.push({...field,file});
    bytes+=pack.length;
  }
  await writeFile(destination,JSON.stringify({version:2,tileRevision,geometry,fields:index}));
  console.log('Prepared foreground depth for '+fields.length+' areas ('+bytes+' bytes).');
}

export async function writeDepth(draw,routes,manifest,style,destination) {
  const fields=routes.regions.map(({id,bounds})=>({id,...depthField(draw,bounds,style)}));
  const tileRevision=style===manifest.artStyle ? manifest.tileRevision : null;
  await writeDepthAssets({fields,geometry:routes.geometry,tileRevision},destination);
}
