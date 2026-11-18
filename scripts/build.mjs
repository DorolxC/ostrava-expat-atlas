import { cp } from 'node:fs/promises';
import { readSceneAssets } from './scene-integrity.mjs';

const publicDir = new URL('../public/', import.meta.url);
await readSceneAssets(new URL('map/',publicDir),{verifyArtwork:true});
await cp(publicDir, new URL('../dist/', import.meta.url), { recursive: true });
console.log('Production site written to dist/.');
