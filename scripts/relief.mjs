import { toGeographic } from '../public/js/geo.js';
import { shade } from './raster.mjs';

const GRID = 20;

export function reliefSampler(source) {
  if (!source) return null;
  const [west,south,east,north] = source.bounds;
  function altitude(x,y) {
    const [lon,lat] = toGeographic(x,y);
    const sx = Math.max(0,Math.min(source.width-1.00001,(lon-west)/(east-west)*(source.width-1)));
    const sy = Math.max(0,Math.min(source.height-1.00001,(north-lat)/(north-south)*(source.height-1)));
    const i = Math.floor(sy)*source.width+Math.floor(sx);
    const dx = sx%1;
    const dy = sy%1;
    const a = source.samples[i]*(1-dx)+source.samples[i+1]*dx;
    const b = source.samples[i+source.width]*(1-dx)+source.samples[i+source.width+1]*dx;
    return a*(1-dy)+b*dy;
  }
  return (x,y) => {
    const sunSlope = (altitude(x+50,y+28)-altitude(x-50,y-28))/78;
    const relief = Math.min(0.9,Math.max(-0.65,sunSlope));
    return relief*(relief>0 ? 27 : 43);
  };
}

// Sample a shared world grid so shaded terrain matches across neighbouring crops.
export function shadeRelief(map,{scale,ox,oy,sample}) {
  if (!sample) return;
  const left = Math.floor(ox/scale/GRID);
  const top = Math.floor(oy/scale/GRID);
  const columns = Math.ceil((ox+map.width)/scale/GRID)-left+2;
  const rows = Math.ceil((oy+map.height)/scale/GRID)-top+2;
  const samples = new Float32Array(rows*columns);
  for (let y=0;y<rows;y++) {
    for (let x=0;x<columns;x++) samples[y*columns+x]=sample((x+left)*GRID,(y+top)*GRID);
  }
  const xWeights = Array.from({length:map.width},(_,x)=>{
    const cell = (x+ox)/scale/GRID-left;
    return [Math.floor(cell),cell%1];
  });
  for (let y=0;y<map.height;y++) {
    const cell = (y+oy)/scale/GRID-top;
    const row = Math.floor(cell)*columns;
    const sy = cell%1;
    for (let x=0;x<map.width;x++) {
      const [column,sx] = xWeights[x];
      const i = row+column;
      const a = samples[i]*(1-sx)+samples[i+1]*sx;
      const b = samples[i+columns]*(1-sx)+samples[i+columns+1]*sx;
      const delta = Math.round(a*(1-sy)+b*sy);
      if (delta!==0) {
        const pixel = y*map.width+x;
        map.pixels[pixel]=shade(map.pixels[pixel],delta);
      }
    }
  }
}
