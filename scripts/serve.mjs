import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../' + (process.argv[2] || 'public') + '/', import.meta.url)).replace(/[\\/]$/, '');
const port = Number(process.env.OSTRAVA_PORT || 4173);
const address = '127.0.0.1';
const diagnostic = process.env.OSTRAVA_GEOMETRY_DIAGNOSTIC === '1';
const diagnosticFiles = new Map([
  ['/_geometry', new URL('./geometry-diagnostic.html',import.meta.url)],
  ['/_geometry.js', new URL('./geometry-diagnostic.js',import.meta.url)],
]);
let network;
async function diagnosticNetwork(style) {
  const { auditNetwork, reviewPoints }=await import('./geometry-audit.mjs');
  const geometry=JSON.parse(await readFile(resolve(root,'map','geometry.json'),'utf8'));
  return JSON.stringify({...auditNetwork(geometry,process.env.OSTRAVA_OSM_PBF,style),reviewPoints});
}
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.geojson': 'application/geo+json', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.webm': 'video/webm',
};

createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (diagnostic && pathname==='/_geometry/network.json') {
      try {
        const { artStyle,tileRevision }=JSON.parse(await readFile(resolve(root,'map','scene.json'),'utf8'));
        const key=(artStyle??'')+' '+(tileRevision??'');
        if (network?.key!==key) network={key,body:diagnosticNetwork(artStyle)};
        const body=await network.body;
        res.writeHead(200,{'Content-Type':mime['.json'],'Cache-Control':'no-store'});
        return res.end(req.method==='HEAD' ? undefined : body);
      } catch (error) {
        network=undefined;
        console.error(error.message);
        return res.writeHead(500).end('Could not prepare geometry diagnostics');
      }
    }
    if (diagnostic && diagnosticFiles.has(pathname)) {
      const file=diagnosticFiles.get(pathname);
      const body=await readFile(file);
      res.writeHead(200,{'Content-Type':mime[extname(file.pathname)],'Cache-Control':'no-store'});
      return res.end(req.method==='HEAD' ? undefined : body);
    }
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, address, () => console.log('Local: http://' + address + ':' + port + '/'));


