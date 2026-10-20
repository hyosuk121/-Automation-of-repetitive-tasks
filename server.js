import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { handler } from './lib/http.js';

const root=resolve('dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
export const server=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/api/')) return handler(req,res);
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://internal').pathname);
    const file=resolve(root,'.'+pathname);
    if(!file.startsWith(root+sep) && file!==root) {res.statusCode=403;return res.end();}
    let data,extension=extname(file);
    try {data=await readFile(file);}
    catch {if(extension) {res.statusCode=404;return res.end('Not found');} data=await readFile(resolve(root,'index.html'));extension='.html';}
    res.setHeader('Content-Type',types[extension] || 'application/octet-stream');res.end(data);
  } catch {res.statusCode=503;res.end('Run npm run build before starting the server.');}
});
server.listen(Number(process.env.PORT || 4173),'0.0.0.0',()=>console.log(`Automation Hub listening on port ${process.env.PORT || 4173}`));
