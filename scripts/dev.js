import { spawn } from 'node:child_process';
const api=spawn(process.execPath,['--env-file-if-exists=.env','server.js'],{stdio:'inherit',env:{...process.env,PORT:'4174'}});
const web=spawn(process.execPath,['node_modules/vite/bin/vite.js','--port','4173',...process.argv.slice(2)],{stdio:'inherit'});
for(const sig of ['SIGINT','SIGTERM']) process.on(sig,()=>{api.kill(sig);web.kill(sig);});
api.on('exit',()=>web.kill());
web.on('exit',code=>{api.kill();process.exitCode=code || 0;});
