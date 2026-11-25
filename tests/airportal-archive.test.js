import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {applyFeatureSchema} from '../lib/automation.js';
import {capturePortal,listPortalSnapshots} from '../lib/airportal-archive.js';
import {collectPortalTick,portalPeriods} from '../lib/airportal-schedule.js';
import {fetchPortal} from '../lib/airportal-source.js';
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const samples=JSON.parse(await readFile(new URL('./fixtures/airportal-observed-20261123.json',import.meta.url),'utf8'));
const sourceRows=rows=>async(kind,period)=>fetchPortal(kind,period,{fetcher:async()=>new Response(JSON.stringify({resultCode:'200',content:rows}),{headers:{'content-type':'application/json'}})});
test('portal observations preserve separate sources, idempotent checks and owner isolation',async()=>{
 const db=new PGlite();try{
  await db.exec(await readFile('supabase/migrations/20261020000000_initial.sql','utf8'));await applyFeatureSchema(db);
  const first=await capturePortal(db,owner,'monthly','202609',{source:sourceRows(samples.monthlyRoute)});
  const again=await capturePortal(db,owner,'monthly','202609',{source:sourceRows(samples.monthlyRoute)});
  assert.equal(first.snapshot.id,again.snapshot.id);assert.equal(again.snapshot.check_count,2);
  await capturePortal(db,owner,'daily','20261112',{source:sourceRows(samples.dailyIncheon)});
  const mine=await listPortalSnapshots(db,owner),theirs=await listPortalSnapshots(db,other);
  assert.equal(Number(mine.monthly[0].total),2725422);assert.equal(mine.daily[0].metric,'daily_departures');
  assert.deepEqual(theirs.monthly,[]);assert.deepEqual(theirs.daily,[]);
 }finally{await db.close();}
});
test('portal scheduler claims one missing day and month per tick after 09 KST',async()=>{
 const db=new PGlite();try{
  await db.exec(await readFile('supabase/migrations/20261020000000_initial.sql','utf8'));await applyFeatureSchema(db);
  const calls=[],capture=async(_db,_owner,kind,period)=>{calls.push([kind,period]);return {snapshot:{id:'test'},status:'observed'};};
  const at=new Date('2026-11-23T00:00:00Z');
  assert.deepEqual(portalPeriods('daily',at).slice(0,2),['20261115','20261114']);
  const options={at,resolveOwner:async()=>owner,capture};
  assert.equal((await collectPortalTick(db,{...options,at:new Date('2026-11-22T23:59:00Z')})).status,'not_due');
  await collectPortalTick(db,options);await collectPortalTick(db,options);
  assert.deepEqual(calls,[['daily','20261115'],['monthly','202610'],['daily','20261114'],['monthly','202609']]);
 }finally{await db.close();}
});
