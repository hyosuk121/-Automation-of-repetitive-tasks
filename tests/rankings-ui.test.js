import test from 'node:test';
import assert from 'node:assert/strict';
import {rankColor,rankingsView} from '../web/rankings.js';
test('competitor colors stay fixed across filtering and normalized names',()=>{
 const expected={'로밍도깨비':'#2A7FF6','유심사':'#0065FF','도시락eSIM':'#416CB0','말톡나우':'#FF650F','모비':'#AA50FF','이심이지':'#F04821','플릿 이심':'#4EE0BB','airalo':'#AE4E78','eskimo':'#0077FF','holafly':'#C90C4E','Saily':'#FFF500'};
 for(const [name,color] of Object.entries(expected))assert.equal(rankColor(name),color);
 assert.equal(rankColor(' AIRALO '),'#AE4E78');
 const rows=Object.keys(expected).map((name,i)=>({app_id:String(i),name,platform:'app_store',day:'2026-10-21',status:'ranked',rank:i+1}));
 const all=rankingsView({rows});
 for(const r of rows){const filtered=rankingsView({rows},{app:r.app_id});assert.ok(filtered.includes(`fill="${expected[r.name]}"`));assert.ok(all.includes(`fill="${expected[r.name]}"`));}
});
