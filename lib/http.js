import {rankingPeriod} from './ranking-period.js';
import {transaction as snapshotTransaction} from './db.js';
import {ensureSnapshotSchema} from './snapshot-schema.js';
import { randomUUID, createHash } from 'node:crypto';
import { db } from './db.js';
import { configuration, signIn, refresh, setSession, requireUser, checkOrigin, checkCron } from './auth.js';
import { fail, listCompetitors, saveCompetitor, getCompetitor, reorder, appHistory } from './repository.js';
import { enqueue, workOnce } from './queue.js';
import {automationTick,automationStatus,installScheduler,applyFeatureSchema} from './automation.js';
import {reportPreview,importReport} from './report-import.js';
import {rankingHistory} from './rankings.js';
import {publicRead,publicOwner} from './public-read.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validId(id) { if (!UUID.test(id)) fail('올바른 ID가 아닙니다.'); return id; }
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail('JSON 요청이 필요합니다.',415);
  if (Number(req.headers['content-length'] || 0)>32768) fail('입력 크기가 너무 큽니다.',413);
  let text='';
  if(req.body != null) text=typeof req.body==='string'?req.body:JSON.stringify(req.body);
  else for await (const chunk of req) { text+=chunk; if(Buffer.byteLength(text)>32768) fail('입력 크기가 너무 큽니다.',413); }
  if(Buffer.byteLength(text)>32768) fail('입력 크기가 너무 큽니다.',413);
  let data;
  try { data=JSON.parse(text || '{}'); } catch { fail('JSON 형식이 올바르지 않습니다.'); }
  if(!data || typeof data!=='object' || Array.isArray(data)) fail('JSON 객체가 필요합니다.');
  return data;
}
export function period(params) {
  const from=params.get('from') || '1970-01-01T00:00:00.000Z';
  let to=params.get('to') || new Date().toISOString();
  if(/^\d{4}-\d{2}-\d{2}$/.test(to)) to+='T23:59:59.999+09:00';
  const start=/^\d{4}-\d{2}-\d{2}$/.test(from)?from+'T00:00:00+09:00':from;
  if(!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(to)) || Date.parse(start)>Date.parse(to)) fail('조회 기간을 확인해 주세요.');
  return {from:new Date(start).toISOString(),to:new Date(to).toISOString()};
}
async function rateLimit(database,key,max) {
  const hashed=createHash('sha256').update(key).digest('hex');
  const row=(await database.query(`INSERT INTO rate_limits(key) VALUES($1) ON CONFLICT(key) DO UPDATE SET
    count=CASE WHEN rate_limits.window_start < now()-interval '1 minute' THEN 1 ELSE rate_limits.count+1 END,
    window_start=CASE WHEN rate_limits.window_start < now()-interval '1 minute' THEN now() ELSE rate_limits.window_start END RETURNING count`,[hashed])).rows[0];
  if(row.count>max) fail('요청이 많습니다. 잠시 후 다시 시도해 주세요.',429);
}
export function createHandler({database=db,authenticate=requireUser,login=signIn,collector,chartCollector,resolvePublicOwner=publicOwner}={}) {
  let schemaReady;
  const prepare=client=>schemaReady??=(snapshotTransaction(client,ensureSnapshotSchema).catch(error=>{schemaReady=null;throw error;}));
  return async function handler(req,res) {
    const requestId=randomUUID();
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Request-ID',requestId);
    const send=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
    try {
      const url=new URL(req.url,'http://internal');
      const path=url.pathname.replace(/\/$/,'');
      const method=req.method;
      if(path==='/api/health' && method==='GET') return send(200,{ok:true,configured:Object.values(configuration()).slice(0,3).every(Boolean)});
      if(path==='/api/config' && method==='GET') return send(200,configuration());
      if(path.startsWith('/api/public/')){
        if(method!=='GET')return send(405,{error:'공개 조회는 읽기만 가능합니다.'});
        const client=database(),owner=await resolvePublicOwner(client);
        const result=await publicRead(client,owner,path.slice('/api/public'.length),url.searchParams,period);
        res.setHeader('Cache-Control','public, max-age=0, s-maxage=30, stale-while-revalidate=30');
        return send(200,result);
      }
      if(path==='/api/cron' && ['GET','POST'].includes(method)) {
        checkCron(req);
        const client=database();
        return send(200,await automationTick(client,{collector,chartCollector}));
      }
      if(!['GET','HEAD'].includes(method)) checkOrigin(req);
      if(path==='/api/auth/login' && method==='POST') {
        const data=await body(req);
        if(typeof data.email!=='string' || typeof data.password!=='string' || data.email.length>254 || data.password.length>1024) fail('이메일과 비밀번호를 확인해 주세요.');
        await rateLimit(database(),'login:'+(req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown'),10);
        const result=await login(data.email,data.password);
        setSession(res,result.session);
        return send(200,{user:{id:result.user.id,email:result.user.email}});
      }
      if(path==='/api/auth/refresh' && method==='POST') {
        const result=await refresh(req);setSession(res,result.session);return send(200,{ok:true});
      }
      if(path==='/api/auth/logout' && method==='POST') {setSession(res,null);return send(200,{ok:true});}
      const user=await authenticate(req);
      if(path==='/api/auth/me' && method==='GET') return send(200,{user:{id:user.id,email:user.email}});
      const databaseClient=database();
      await prepare(databaseClient);
      if(path==='/api/collections/process' && method==='POST') {
        await rateLimit(databaseClient,'collect:'+user.id,120);
        return send(200,{processed:await workOnce(databaseClient,collector,user.id)});
      }
      if(!['GET','HEAD'].includes(method)) await rateLimit(databaseClient,'write:'+user.id,60);
      if(path==='/api/automation' && method==='GET')return send(200,await automationStatus(databaseClient));
      if(path==='/api/automation/schema' && method==='POST'){await applyFeatureSchema(databaseClient);return send(200,await automationStatus(databaseClient));}
      if(path==='/api/automation/install' && method==='POST'){
        try{return send(200,await installScheduler(databaseClient));}
        catch(error){console.error(JSON.stringify({event:'scheduler_install_error',code:error.code||'internal'}));return send(503,{error:'자동 실행 설정에 실패했습니다. Supabase Database → Extensions에서 pg_cron, pg_net, supabase_vault 지원 여부와 DB 계정 권한을 확인해 주세요. 기존 데이터는 유지됩니다.'});}
      }
      if(path==='/api/imports/july' && method==='GET')return send(200,await reportPreview(databaseClient,user.id));
      if(path==='/api/imports/july' && method==='POST')return send(200,await importReport(databaseClient,user.id,(await body(req)).mappings));
      if(path==='/api/rankings' && method==='GET'){
        return send(200,await rankingHistory(databaseClient,user.id,rankingPeriod(url.searchParams)));
      }
      if(['/api/competitors','/api/apps','/api/dashboard'].includes(path) && method==='GET')
        return send(200,{competitors:await listCompetitors(databaseClient,user.id,url.searchParams.get('archived')==='true')});
      if(['/api/competitors','/api/apps'].includes(path) && method==='POST') {
        const competitor=await saveCompetitor(databaseClient,user.id,await body(req));
        const run=await enqueue(databaseClient,user.id,{ids:[competitor.id]});
        return send(201,{...competitor,collectionRunId:run.id});
      }
      if(['/api/competitors/reorder','/api/apps/reorder'].includes(path) && method==='POST') {
        const data=await body(req);await reorder(databaseClient,user.id,data.ids);return send(200,{ok:true});
      }
      const competitorMatch=path.match(/^\/api\/(?:competitors|apps)\/([^/]+)(?:\/(collect|refresh))?$/);
      if(competitorMatch) {
        const id=validId(competitorMatch[1]);
        if(!competitorMatch[2] && method==='GET') {
          const competitor=await getCompetitor(databaseClient,user.id,id);
          const apps=(await databaseClient.query('SELECT * FROM store_apps WHERE competitor_id=$1 ORDER BY is_active DESC,platform',[id])).rows;
          return send(200,{...competitor,apps});
        }
        if(competitorMatch[2] && method==='POST') {
          await getCompetitor(databaseClient,user.id,id);
          const run=await enqueue(databaseClient,user.id,{ids:[id]});
          return send(202,{collectionRunId:run.id,status:run.status});
        }
        if(!competitorMatch[2] && method==='PATCH') return send(200,await saveCompetitor(databaseClient,user.id,await body(req),id));
        if(!competitorMatch[2] && method==='DELETE') {
          await getCompetitor(databaseClient,user.id,id);
          await databaseClient.query('UPDATE competitors SET archived_at=now(),auto_collect=false WHERE id=$1 AND owner_id=$2',[id,user.id]);
          return send(200,{ok:true});
        }
      }
      if(path==='/api/collections' && method==='POST') {
        const data=await body(req);
        if(data.ids!=null && (!Array.isArray(data.ids) || data.ids.length>100 || !data.ids.every(id=>UUID.test(id)))) fail('수집 대상 목록을 확인해 주세요.');
        const run=await enqueue(databaseClient,user.id,{ids:data.ids || null});
        return send(202,{collectionRunId:run.id,status:run.status});
      }
      if(path==='/api/collections' && method==='GET') {
        const offset=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0));
        const runs=(await databaseClient.query(`SELECT r.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('status',i.status,'error',i.error_message,'platform',a.platform,'name',c.name))
          FROM collection_items i JOIN store_apps a ON a.id=i.store_app_id JOIN competitors c ON c.id=a.competitor_id
          WHERE i.collection_run_id=r.id),'[]') items FROM collection_runs r WHERE r.owner_id=$1 ORDER BY r.created_at DESC LIMIT 50 OFFSET $2`,[user.id,offset])).rows;
        return send(200,{runs,offset});
      }
      const runMatch=path.match(/^\/api\/collections\/([^/]+)$/);
      if(runMatch && method==='GET') {
        const run=(await databaseClient.query('SELECT * FROM collection_runs WHERE id=$1 AND owner_id=$2',[validId(runMatch[1]),user.id])).rows[0];
        if(!run) fail('수집 작업을 찾을 수 없습니다.',404);
        const items=(await databaseClient.query('SELECT * FROM collection_items WHERE collection_run_id=$1',[run.id])).rows;
        return send(200,{...run,items});
      }
      const appMatch=path.match(/^\/api\/store-apps\/([^/]+)\/(history|snapshots|releases|changes)$/);
      if(appMatch && method==='GET') {
        const {from,to}=period(url.searchParams);
        const limit=Math.max(1,Math.min(200,Number(url.searchParams.get('limit'))||200));
        const offset=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0));
        const result=await appHistory(databaseClient,user.id,validId(appMatch[1]),from,to,limit,offset);
        return send(200,appMatch[2]==='history'?result:{[appMatch[2]]:result[appMatch[2]],limit,offset});
      }
      if(path==='/api/export' && method==='GET') {
        await rateLimit(databaseClient,'export:'+user.id,10);
        const {exportData}=await import('./export.js');
        const result=await exportData(databaseClient,user.id,{...period(url.searchParams),mode:url.searchParams.get('mode') || 'latest',format:url.searchParams.get('format') || 'xlsx'});
        res.setHeader('Content-Type',result.type);
        res.setHeader('Content-Disposition',`attachment; filename="competitor-${new Date().toISOString().slice(0,10)}.${result.ext}"`);
        return res.end(result.body);
      }
      send(404,{error:'요청한 API를 찾을 수 없습니다.'});
    } catch(error) {
      const certificateError=['SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(error.code);
      const status=certificateError?503:error.status || 500;
      if(status>=500) console.error(JSON.stringify({event:'api_error',requestId,code:error.code || 'internal'}));
      send(status,{error:certificateError
        ?'DB 인증서를 확인하지 못했습니다. Vercel의 DATABASE_CA_CERT에 Supabase CA 인증서를 등록하고 재배포해 주세요.'
        :status===500?'처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.':error.message,requestId});
    }
  };
}
export const handler=createHandler();
