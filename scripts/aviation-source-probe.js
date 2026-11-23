import {load} from 'cheerio';
import {writeFile,mkdir} from 'node:fs/promises';

const pages={
 monthlyCountry:'https://www.airportal.go.kr/stats/transport/chartDetail4.do',
 monthlySeries:'https://www.airportal.go.kr/stats/transport/chartDetail5.do',
 monthlyRoute:'https://www.airportal.go.kr/stats/transport/chartDetail3.do',
 dailyRoute:'https://www.airportal.go.kr/stats/transport/dailyRoute.do'
};
const origin='https://www.airportal.go.kr';
const clean=value=>String(value||'').trim().slice(0,300);
const absolute=(path,base)=>{try{const url=new URL(path,base);return url.origin===origin?url.href:null;}catch{return null;}};
const result={checkedAt:new Date().toISOString(),pages:{}};
try{
 const response=await fetch(origin+'/js/egovframework/util.js',{signal:AbortSignal.timeout(20000)});
 const helper=await response.text();
 result.helper={status:response.status,callSnippets:[...helper.matchAll(/(?:call|excel|koreaAirportIaco)\s*[:=]\s*function|(?:call|excel|koreaAirportIaco)\s*\([^)]*\)\s*\{/g)].slice(0,12).map(match=>helper.slice(Math.max(0,match.index-150),Math.min(helper.length,match.index+1300)))};
}catch(error){result.helper={error:clean(error?.message)};}
for(const [name,url] of Object.entries(pages)){
 try{
  const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(20000),headers:{'User-Agent':'HyoseoksAutomation/1.0 (official data source review)'}});
  const final=new URL(response.url);
  const size=Number(response.headers.get('content-length')||0);
  if(final.origin!==origin||size>2500000)throw new Error('unexpected destination or size');
  const html=await response.text();
  if(html.length>2500000)throw new Error('response too large');
  const $=load(html);
  result.pages[name]={
   status:response.status,url:final.href,title:clean($('title').text()),
   controls:$('input,select').toArray().slice(0,100).map(el=>({tag:el.tagName,id:clean($(el).attr('id')),name:clean($(el).attr('name')),type:clean($(el).attr('type'))})).filter(x=>x.id||x.name),
   inlinePaths:[...new Set($('script:not([src])').toArray().flatMap(el=>($(el).html()||'').match(/[\w./-]+\.(?:do|json|csv|xlsx?)/g)||[]))].filter(path=>!path.includes('..')).slice(0,120),
   relevantSnippets:[...new Set($('script:not([src])').toArray().flatMap(el=>{
    const script=$(el).html()||[],matches=[...String(script).matchAll(/(?:selectDailyStatisticsByRoute|DetailedAirTransportStats[1-4](?:Time)?(?:Excel)?|getAirTransportStatsYearMonthCount)\.do/g)];
    return matches.map(match=>String(script).slice(Math.max(0,match.index-700),Math.min(String(script).length,match.index+900)).slice(0,1600));
   }))].slice(0,30),
   airportSnippets:name==='dailyRoute'?[...new Set($('script:not([src])').toArray().flatMap(el=>{
    const script=String($(el).html()||'');return [...script.matchAll(/koreaAirportSelect|airlineType/g)].slice(0,20).map(match=>script.slice(Math.max(0,match.index-450),Math.min(script.length,match.index+650)));
   }))].slice(0,25):[],
   lookupSnippets:name==='monthlyRoute'?[...new Set($('script:not([src])').toArray().flatMap(el=>{
    const script=String($(el).html()||'');return [...script.matchAll(/getAirportGubun\.do|getForeignAirportGubun\.do/g)].slice(0,12).map(match=>script.slice(Math.max(0,match.index-500),Math.min(script.length,match.index+650)));
   }))].slice(0,15):[],
   selectOptions:$('select').toArray().slice(0,30).map(el=>({id:clean($(el).attr('id')),options:$(el).find('option').toArray().slice(0,40).map(option=>({value:clean($(option).attr('value')),label:clean($(option).text())}))})),
   tabs:$('.sel_min_tab [data-type]').toArray().map(el=>({label:clean($(el).text()),type:clean($(el).attr('data-type'))})),
   forms:$('form').toArray().slice(0,25).map(el=>({method:clean($(el).attr('method')||'GET').toUpperCase(),action:absolute($(el).attr('action')||'',final.href),fields:$(el).find('input[name],select[name],textarea[name]').toArray().slice(0,60).map(field=>({name:clean($(field).attr('name')),type:clean($(field).attr('type')||field.tagName)}))})),
   scripts:$('script[src]').toArray().map(el=>absolute($(el).attr('src'),final.href)).filter(Boolean).slice(0,60),
   candidateLinks:$('a[href]').toArray().filter(el=>/다운로드|엑셀|excel|csv|api|통계/i.test($(el).text()+' '+$(el).attr('href'))).slice(0,40).map(el=>({label:clean($(el).text()),href:absolute($(el).attr('href'),final.href)}))
  };
 }catch(error){result.pages[name]={error:clean(error?.message||'request failed')};}
}
result.samples={};
async function publicPost(path,body){
 const response=await fetch(origin+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json;charset=UTF-8','Accept':'application/json','request-call':'web-rest','Origin':origin,'Referer':pages.dailyRoute},body:JSON.stringify(body)});
 const text=await response.text();
 if(text.length>1000000)throw new Error('response too large');
 return {status:response.status,data:JSON.parse(text)};
}
let airportCode='ICN';
let monthlyAirportCode='RKSI';
try{
 const airports=await publicPost('/common/searchKrAirportIaco.do',{});
 const rows=Array.isArray(airports.data?.content)?airports.data.content:[];
 const incheon=rows.find(row=>row.apIata==='ICN'||String(row.codeVal||'').includes('인천'));
 if(incheon?.codeId)airportCode=incheon.codeId;
 result.samples.airportLookup={status:airports.status,resultCode:airports.data?.resultCode,count:rows.length,incheon};
}catch(error){result.samples.airportLookup={error:clean(error?.message)};}
for(const [name,path] of Object.entries({monthlyAirportLookup:'/common/getAirportGubun.do',foreignAirportLookup:'/common/getForeignAirportGubun.do'})){
 try{
  const response=await publicPost(path,{}),rows=Array.isArray(response.data?.content)?response.data.content:[];
  result.samples[name]={status:response.status,resultCode:response.data?.resultCode,count:rows.length,firstRows:rows.slice(0,5),incheon:rows.find(row=>Object.values(row).some(value=>String(value).includes('인천')||value==='RKSI'||value==='ICN'))};
  if(name==='monthlyAirportLookup'&&result.samples[name].incheon)monthlyAirportCode=result.samples[name].incheon.codeId||result.samples[name].incheon.code_id||monthlyAirportCode;
 }catch(error){result.samples[name]={error:clean(error?.message)};}
}
const requests={
 dailyIncheon:{path:'/stats/transport/selectDailyStatisticsByRoute.do',body:{startDt:'20261112',endDt:'20261112',koreaAirport:airportCode,airlineType:'I'}},
 monthlyRoute:{path:'/stats/transport/getDetailedAirTransportStats3.do',body:{last_yearmonth:'202609',this_yearmonth:'202609',sn_gubun:'total',airport_gubun:monthlyAirportCode,pass_gubun:'1',carge_gubun:'total',forreign_airport_gubun:'total',di_gubun:'I',arvl_type:'D',pyn_gubun:'Y'}},
 monthlyRecent:{path:'/stats/transport/getDetailedAirTransportStats4.do',body:{last_yearmonth:'202609',this_yearmonth:'202609',sn_gubun:'99',pass_gubun:'1',arvl_type:'D',carge_gubun:'total',pyn_gubun:'Y'}},
 monthlyHistorical:{path:'/stats/transport/getDetailedAirTransportStats4.do',body:{last_yearmonth:'202101',this_yearmonth:'202101',sn_gubun:'99',pass_gubun:'1',arvl_type:'D',carge_gubun:'total',pyn_gubun:'Y'}}
};
for(const [name,{path,body}] of Object.entries(requests)){
 try{
  const response=await fetch(origin+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json;charset=UTF-8','Accept':'application/json','request-call':'web-rest','Origin':origin,'Referer':pages[name.startsWith('daily')?'dailyRoute':'monthlyCountry']},body:JSON.stringify(body)});
  const length=Number(response.headers.get('content-length')||0);
  if(length>1000000)throw new Error('response too large');
  const text=await response.text();
  if(text.length>1000000)throw new Error('response too large');
  let parsed;try{parsed=JSON.parse(text);}catch{}
  const rows=Array.isArray(parsed?.content)?parsed.content:[];
  result.samples[name]={status:response.status,contentType:response.headers.get('content-type'),resultCode:parsed?.resultCode,contentCount:rows.length,firstRows:rows.slice(0,2),bodyExcerpt:parsed?undefined:clean(text.slice(0,300))};
 }catch(error){result.samples[name]={error:clean(error?.message||'request failed')};}
}
try{
 const robots=await fetch(origin+'/robots.txt',{signal:AbortSignal.timeout(10000)});
 result.robots={status:robots.status,text:(await robots.text()).slice(0,5000)};
}catch(error){result.robots={error:clean(error?.message)};}
await mkdir('docs',{recursive:true});
await writeFile('docs/aviation-source-probe.json',JSON.stringify(result,null,2)+'\n');
