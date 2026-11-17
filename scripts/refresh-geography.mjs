import { copyFile } from 'node:fs/promises';

await import('./data/compile-geography.mjs');
await import('./data/compile-districts.mjs');
for (const [source,target] of [
  ['geometry.json','geometry.json'], ['boundary.geojson','boundary.json'],
  ['districts.json','districts.json'], ['districts.geojson','districts.geojson'],
]) {
  await copyFile(new URL('./data/'+source,import.meta.url),new URL('../public/map/'+target,import.meta.url));
}
console.log('Updated bundled map geometry and district files.');
