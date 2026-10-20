import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import tls from 'node:tls';
import http from 'node:http';
import { databaseOptions } from '../lib/db.js';
import { createHandler } from '../lib/http.js';

let directory,ca,server;
const url='postgresql://test:test@localhost:5432/test';
before(async()=>{
  directory=await mkdtemp(join(tmpdir(),'automation-tls-'));
  const openssl=args=>execFileSync('openssl',args,{cwd:directory,stdio:'ignore'});
  openssl(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.crt','-days','1','-subj','/CN=Automation test CA','-addext','basicConstraints=critical,CA:TRUE']);
  openssl(['req','-newkey','rsa:2048','-nodes','-keyout','server.key','-out','server.csr','-subj','/CN=localhost']);
  await writeFile(join(directory,'extensions.cnf'),'subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n');
  openssl(['x509','-req','-in','server.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-out','server.crt','-days','1','-extfile','extensions.cnf']);
  ca=await readFile(join(directory,'ca.crt'),'utf8');
  server=tls.createServer({key:await readFile(join(directory,'server.key')),cert:await readFile(join(directory,'server.crt'))},socket=>socket.end());
  server.on('tlsClientError',()=>{});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
});
after(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(directory)await rm(directory,{recursive:true,force:true});
});
function connect(options,servername='localhost') {
  return new Promise((resolve,reject)=>{
    const socket=tls.connect({host:'127.0.0.1',port:server.address().port,servername,...options});
    socket.once('secureConnect',()=>{const authorized=socket.authorized;socket.destroy();resolve(authorized);});
    socket.once('error',error=>{socket.destroy();reject(error);});
  });
}
test('DB certificate variable accepts multiline and escaped-newline PEM without weakening TLS',async()=>{
  for(const value of [ca,ca.replaceAll('\n','\\n')]) {
    const options=databaseOptions({DATABASE_URL:url+'?sslmode=no-verify',DATABASE_CA_CERT:value});
    assert.equal(options.ssl.rejectUnauthorized,true);
    assert.equal(new URL(options.connectionString).searchParams.has('sslmode'),false);
    assert.equal(await connect(options.ssl),true);
  }
});
test('DB TLS rejects missing trust and a wrong hostname even with the configured CA',async()=>{
  await assert.rejects(()=>connect(databaseOptions({DATABASE_URL:url}).ssl));
  await assert.rejects(()=>connect(databaseOptions({DATABASE_URL:url,DATABASE_CA_CERT:ca}).ssl,'wrong-host.example'),
    error=>error.code==='ERR_TLS_CERT_ALTNAME_INVALID');
});
test('CA file remains supported and malformed certificate input fails closed',async()=>{
  assert.equal(await connect(databaseOptions({DATABASE_URL:url,DATABASE_CA_FILE:join(directory,'ca.crt')}).ssl),true);
  for(const value of ['not a certificate','-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----',ca+'\nextra garbage']) {
    assert.throws(()=>databaseOptions({DATABASE_URL:url,DATABASE_CA_CERT:value}),/DB 인증서 형식/);
  }
  assert.doesNotThrow(()=>databaseOptions({DATABASE_URL:url,DATABASE_CA_CERT:ca,DATABASE_CA_FILE:'/missing'}));
});
test('login certificate failures return a specific safe setup message rather than generic HTTP 500',async()=>{
  const original=process.env.APP_ORIGIN;
  process.env.APP_ORIGIN='https://example.com';
  const handler=createHandler({database:()=>({query:async()=>{throw Object.assign(new Error('sensitive connection info'),{code:'SELF_SIGNED_CERT_IN_CHAIN'});}})});
  const api=http.createServer(handler);
  await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
  try {
    const response=await fetch(`http://127.0.0.1:${api.address().port}/api/auth/login`,{
      method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:JSON.stringify({email:'test@example.com',password:'test'})
    });
    assert.equal(response.status,503);
    const result=await response.json();
    assert.match(result.error,/DATABASE_CA_CERT/);
    assert.ok(!result.error.includes('sensitive'));
  }finally{
    await new Promise(resolve=>api.close(resolve));
    if(original===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=original;
  }
});
