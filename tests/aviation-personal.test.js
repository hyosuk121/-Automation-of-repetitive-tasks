import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {savePersonal,listPersonal,deletePersonal,validatePersonal} from '../lib/aviation-personal.js';
test('private aviation CRUD is owner scoped, validates fields, and keeps note context on edit',async()=>{
 const d=new PGlite(),a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
 try{await d.exec('CREATE TABLE schema_migrations(version text PRIMARY KEY)');await d.exec(await readFile('supabase/migrations/20261120010000_aviation_personal.sql','utf8'));
 const data={kind:'note',title:'観察',payload:{month:'2026-09',tab:'market',countries:['JP'],text:'<script>private</script>'}};
 const {id}=await savePersonal(d,a,data);assert.equal((await listPersonal(d,a))[0].payload.text,data.payload.text);assert.deepEqual(await listPersonal(d,b),[]);
 await assert.rejects(savePersonal(d,b,data,id),e=>e.status===404);await assert.rejects(deletePersonal(d,b,id),e=>e.status===404);
 await savePersonal(d,a,{...data,title:'edited'},id);assert.equal((await listPersonal(d,a))[0].payload.month,'2026-09');
 await savePersonal(d,a,{...data,kind:'preferences'});await savePersonal(d,a,{...data,kind:'preferences',payload:{...data.payload,countries:[]}});assert.equal((await listPersonal(d,a)).length,2);
 assert.throws(()=>validatePersonal({...data,payload:{...data.payload,month:'2026-13'}}));assert.throws(()=>validatePersonal({...data,payload:{...data.payload,countries:['invalid']}}));
 await deletePersonal(d,a,id);assert.equal((await listPersonal(d,a)).length,1);
 }finally{await d.close();}
});
