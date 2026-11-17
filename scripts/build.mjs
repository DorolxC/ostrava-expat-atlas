import { cp, access } from 'node:fs/promises';

const publicDir = new URL('../public/', import.meta.url);
await access(new URL('map/scene.json', publicDir));
await cp(publicDir, new URL('../dist/', import.meta.url), { recursive: true });
console.log('Production site written to dist/.');
