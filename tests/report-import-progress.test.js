import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importInSteps} from '../web/report-import.js';
test('report import commits one app at a time, reports progress and safely resumes after failure',async()=>{
 const mappings=[{key:'a',appId:'1'},{key:'b',appId:'2'},{key:'c',appId:'3'}];
 const saved=new Set(),events=[];let fail=true,active=0;
 const request=async m=>{assert.equal(active++,0);await Promise.resolve();active--;if(m.key==='b'&&fail)throw Error('temporary');if(saved.has(m.key))return{imported:0,skipped:1};saved.add(m.key);return{imported:1,skipped:0};};
 await assert.rejects(importInSteps(mappings,request,p=>events.push(p)),/temporary/);
 assert.deepEqual([...saved],['a']);assert.equal(events.at(-1).completed,1);assert.equal(events.at(-1).mapping.key,'b');
 fail=false;assert.deepEqual(await importInSteps(mappings,request),{imported:2,skipped:1});assert.equal(saved.size,3);
 await assert.rejects(importInSteps([{key:'a',appId:'1'},{key:'b',appId:'1'}],request),/같은 앱/);
});
