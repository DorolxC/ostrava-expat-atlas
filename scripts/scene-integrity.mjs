import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

export const digest=data=>createHash('sha256').update(data).digest('hex');
export const shortDigest=data=>digest(data).slice(0,16);
export const foregroundRevision=object=>object.occlusionRevision??object.tileRevision;

export async function readSceneAssets(folder,{verifyArtwork=false}={}) {
  const [geo,roads,depth,scene]=await Promise.all(['geometry.json','world-routes.json','world-depth.json','scene.json']
    .map(name=>readFile(new URL(name,folder))));
  const routes=JSON.parse(roads), mask=JSON.parse(depth), manifest=JSON.parse(scene);
  const geometry=digest(geo);
  assert(routes.version===1 && mask.version===2,'Unsupported dynamic-world format. Run npm run map:routes and npm run map:world.');
  assert(routes.geometry===geometry && (!manifest.geometryRevision || manifest.geometryRevision===geometry),
    'Map geography differs from the artwork or activity routes. Refresh the routes and render the matching geography.');
  assert(routes.revision===shortDigest(JSON.stringify(routes.regions)),'World route revision is stale. Run npm run map:routes.');
  assert(foregroundRevision(mask)===foregroundRevision(manifest) && mask.revision===routes.revision && mask.geometry===geometry,
    'Foreground masks do not match this artwork and route layout. Run npm run map:world before building.');
  const fields=new Map(mask.fields.map(field=>[field.id,field]));
  assert(fields.size===mask.fields.length && fields.size===routes.regions.length,'Foreground index has missing or duplicate areas. Run npm run map:world.');
  for (const {id} of routes.regions) {
    const field=fields.get(id);
    assert(field?.file==='world-depth/'+id+'.json.gz','Missing foreground field '+id+'. Run npm run map:world.');
    const asset=JSON.parse(gunzipSync(await readFile(new URL(field.file,folder))));
    assert(asset.id===id && foregroundRevision(asset)===foregroundRevision(manifest) && asset.revision===routes.revision,
      'Foreground field '+id+' is stale. Run npm run map:world.');
  }
  if (verifyArtwork) {
    const artwork=createHash('sha256');
    for (const {name,revision} of [manifest,...manifest.closeups].flatMap(level=>level.tiles)) {
      const bytes=await readFile(new URL(name,folder));
      assert(!revision || revision===shortDigest(bytes),'Stale tile fingerprint for '+name+'. Render the corresponding manifest.');
      artwork.update(name).update(bytes);
    }
    assert(manifest.tileRevision===artwork.digest('hex').slice(0,16),'Static tile bytes differ from the scene manifest. Render the corresponding manifest.');
  }
  return {geo,routes,mask,manifest};
}
