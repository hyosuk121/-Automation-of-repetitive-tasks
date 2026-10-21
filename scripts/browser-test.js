// Ephemeral integration harness. No test-auth route or fixture data is shipped in the app.
import { chromium } from 'playwright-core';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'node:http';
import { readFile,mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve,extname } from 'node:path';
import assert from 'node:assert/strict';
import {koreanDay} from '../lib/rankings.js';
import {applyFeatureSchema} from '../lib/automation.js';
import { createHandler } from '../lib/http.js';
import { vercelHandler } from '../lib/vercel-handler.js';
import { workOnce,enqueue } from '../lib/queue.js';
import { listCompetitors } from '../lib/repository.js';

const owner='00000000-0000-4000-8000-000000000001';
const database=new PGlite();
await database.exec(await readFile('supabase/migrations/20261020000000_initial.sql','utf8'));
await applyFeatureSchema(database);
const result={appName:'Fixture App',developerName:'Test developer',iconUrl:'https://icons.example.test/app.png',version:'1.0',sourceUpdatedAt:'2026-10-20',rating:4.5,ratingCount:32,reviewCount:null,downloadsText:null,latestNotes:'첫 번째 업데이트',releases:[{version:'1.0',releaseDate:'2026-10-20',notes:'첫 번째 업데이트'}],historyComplete:true,quality:'complete'};
let collectionRequests=0;
const handler=vercelHandler(createHandler({database:()=>database,authenticate:async()=>({id:owner,email:'fixture@example.com'}),collector:async()=>{collectionRequests++;return result;}}));
let configured=false;
const server=createServer(async(req,res)=>{
  if(req.url.startsWith('/api/')){
    if(!configured && req.url==='/api/config'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({database:false,authentication:false,origin:false}));return;}
    if(!configured && req.url==='/api/auth/me'){res.statusCode=401;res.end('{"error":"login required"}');return;}
    const original=new URL(req.url,'http://test');
    original.searchParams.set('__route',original.pathname.slice('/api/'.length));
    req.url='/api/handler'+original.search;
    return handler(req,res);
  }
  try{
    let file=resolve('dist','.'+new URL(req.url,'http://test').pathname),extension=extname(file),data;
    try{data=await readFile(file);}catch{data=await readFile('dist/index.html');extension='.html';}
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.woff':'font/woff','.woff2':'font/woff2','.svg':'image/svg+xml'})[extension]||'application/octet-stream');
    res.end(data);
  }catch{res.statusCode=500;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN=base;
process.env.COLLECTION_INTERVAL_SECONDS='0';
await mkdir('test-results',{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':chromium.executablePath()),headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true});
await context.route('https://icons.example.test/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64')}));
const page=await context.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(base);await page.getByRole('heading',{name:'경쟁사 앱 업데이트 조사 자동화'}).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:'test-results/portal-desktop.png',fullPage:true});
  assert.equal(await page.getByRole('button',{name:/준비 중/}).isDisabled(),true);
  await page.getByRole('button',{name:'다음 도구'}).click();
  await page.getByRole('button',{name:'이전 도구'}).click();
  await page.getByRole('button',{name:'실행하기'}).click();
  assert.equal(new URL(page.url()).pathname,'/competitor-analyzer');
  await page.getByRole('heading',{name:'업데이트 대시보드'}).waitFor();
  await page.getByText('서비스 연결을 준비하고 있습니다').waitFor();
  await page.screenshot({path:'test-results/dashboard-unconfigured.png',fullPage:true});
  await page.getByRole('button',{name:'설정 안내'}).click();
  await page.getByRole('heading',{name:'서비스 연결 안내'}).waitFor();
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await page.goto(base);await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:'test-results/portal-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('.card-track').focus();await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>document.querySelector('[data-select-card="1"]').getAttribute('aria-pressed')==='true');
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('button',{name:'실행하기'}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'test-results/dashboard-mobile.png',fullPage:true});
  console.log('PASS: desktop/mobile portal, disabled card, keyboard carousel, routing and setup guidance');

  configured=true;
  process.env.DATABASE_URL='test-only';
  process.env.SUPABASE_URL='https://test-only.supabase.co';
  process.env.SUPABASE_ANON_KEY='test-only';
  process.env.ADMIN_EMAILS='fixture@example.com';
  await page.setViewportSize({width:1440,height:1050});await page.reload();
  await page.getByRole('button',{name:'로그아웃'}).waitFor();
  await page.getByRole('button',{name:'경쟁사 등록',exact:true}).click();
  await page.getByLabel(/경쟁사명/).fill('테스트 경쟁사');
  await page.getByLabel('App Store 링크').fill('https://apps.apple.com/kr/app/id123456');
  await page.getByRole('button',{name:'등록하고 첫 수집 시작'}).click();
  await page.getByRole('button',{name:'테스트 경쟁사',exact:true}).waitFor();

  await page.locator('#table-content').getByText('1.0',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('img[data-app-icon]')?.naturalWidth>0);
  assert.equal(await page.locator('img[data-app-icon]').getAttribute('alt'),'테스트 경쟁사 앱 아이콘');
  await page.getByText('평점 수 32',{exact:true}).waitFor();
  await page.getByText('업데이트 내용 보기',{exact:true}).click();
  await page.locator('.latest-notes-cell').getByText('첫 번째 업데이트',{exact:true}).waitFor();
  await page.locator('img[data-app-icon]').dispatchEvent('error');
  assert.equal(await page.locator('img[data-app-icon]').count(),0);
  assert.equal(collectionRequests,1); // Browser triggered the production process endpoint, no worker.
  const competitor=(await listCompetitors(database,owner))[0];
  await enqueue(database,owner,{ids:[competitor.id]});
  await workOnce(database,async()=>({...result,rating:4.7,latestNotes:'수정된 설명',releases:[{...result.releases[0],notes:'수정된 설명'}]}));
  await page.reload();await page.locator('#table-content').getByText('변경 있음',{exact:true}).waitFor();
  await page.screenshot({path:'test-results/dashboard-fixture.png',fullPage:true});
  await page.getByRole('button',{name:'테스트 경쟁사',exact:true}).click();
  await page.getByRole('heading',{name:'테스트 경쟁사',exact:true}).waitFor();
  await page.locator('#modal').getByText('수정된 설명',{exact:true}).first().waitFor();
  await page.getByRole('button',{name:'시점별 수치'}).click();
  await page.getByRole('cell',{name:'4.7',exact:true}).waitFor();
  await page.getByRole('button',{name:'릴리즈 이력'}).click();
  await page.screenshot({path:'test-results/history-fixture.png',fullPage:true});
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('button',{name:'내보내기',exact:true}).click();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'다운로드',exact:true}).click();
  const download=await downloadPromise;
  assert.ok(download.suggestedFilename().endsWith('.xlsx'));
  await download.saveAs('test-results/export-fixture.xlsx');
  await page.getByRole('button',{name:'자동 수집 · 과거 기록',exact:true}).click();
  await page.getByRole('heading',{name:'매일 오전 9시 자동 수집'}).waitFor();
  await page.getByRole('button',{name:'데이터 저장 준비만 적용'}).click();
  await page.getByText('데이터 저장 준비를 완료했습니다.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'7월 9일 자료 연결 · 가져오기'}).click();
  await page.getByRole('heading',{name:'7월 9일 자료 연결'}).waitFor();
  await page.locator('#report-import-form select').first().selectOption(competitor.apps[0].id);
  await page.getByRole('button',{name:'선택한 기록 가져오기'}).click();
  await page.getByText('1개 앱의 과거 기록을 가져왔습니다. 기존 가져오기 0개는 유지했습니다.',{exact:true}).waitFor();
  assert.equal((await listCompetitors(database,owner))[0].apps[0].snapshot.latest_notes,'수정된 설명');
  for(const [days,rank] of [[2,null],[1,20],[0,18]]){
    const run=(await database.query("INSERT INTO ranking_runs(platform,country,chart_day,status,collected_at,source_count) VALUES('app_store','kr',$1,'succeeded',now(),100) RETURNING id",[koreanDay(new Date(Date.now()-days*86400000))])).rows[0];
    for(let n=1;n<=100;n++)await database.query('INSERT INTO ranking_entries(run_id,external_id,rank) VALUES($1,$2,$3)',[run.id,n===rank?'123456':String(900000+n),n]);
  }
  await page.getByRole('button',{name:'카테고리 순위',exact:true}).click();
  await page.getByRole('cell',{name:'18위',exact:true}).first().waitFor();
  await page.getByRole('cell',{name:'▲ 2',exact:true}).waitFor();
  assert.equal(await page.locator('.rank-chart circle').count(),2);
  await page.getByText('일별 데이터 보기',{exact:true}).click();
  await page.getByRole('cell',{name:'순위권 밖',exact:true}).waitFor();
  await page.screenshot({path:'test-results/rankings-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'test-results/rankings-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1050});
  await page.getByRole('button',{name:'대시보드',exact:true}).click();
  await page.getByRole('button',{name:'테스트 경쟁사 수정'}).click();
  await page.getByLabel(/경쟁사명/).fill('수정한 경쟁사');
  await page.getByRole('button',{name:'변경 사항 저장'}).click();
  await page.getByRole('button',{name:'수정한 경쟁사',exact:true}).waitFor();
  await page.getByRole('button',{name:'수정한 경쟁사 보관'}).click();
  await page.getByRole('button',{name:'보관하기',exact:true}).click();
  await page.getByRole('button',{name:/경쟁사 관리/}).click();
  await page.getByLabel('보관 포함').check();
  await page.getByRole('button',{name:'수정한 경쟁사',exact:true}).waitFor();
  await page.getByRole('button',{name:'수집 이력',exact:true}).click();
  await page.getByText('수동 수집',{exact:true}).first().waitFor();
  assert.equal((await database.query('SELECT count(*) FROM store_snapshots')).rows[0].count,3);
  assert.deepEqual(errors,[]);
  console.log('PASS: SQL-backed collection, July report merge, rankings/graph on desktop/mobile, history, export, edit and archive');
  console.log('PASS: no uncaught browser exceptions. Fixture data exists only in the ephemeral test database.');
}finally{
  await browser.close();await new Promise(r=>server.close(r));await database.close();
}
