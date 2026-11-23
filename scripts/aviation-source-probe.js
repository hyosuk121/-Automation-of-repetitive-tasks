import {load} from 'cheerio';
import {writeFile,mkdir} from 'node:fs/promises';

const pages={
 monthlyCountry:'https://www.airportal.go.kr/stats/transport/chartDetail4.do',
 monthlySeries:'https://www.airportal.go.kr/stats/transport/chartDetail5.do',
 dailyRoute:'https://www.airportal.go.kr/stats/transport/dailyRoute.do'
};
const origin='https://www.airportal.go.kr';
const clean=value=>String(value||'').trim().slice(0,300);
const absolute=(path,base)=>{try{const url=new URL(path,base);return url.origin===origin?url.href:null;}catch{return null;}};
const result={checkedAt:new Date().toISOString(),pages:{}};
try{
 const response=await fetch(origin+'/js/egovframework/util.js',{signal:AbortSignal.timeout(20000)});
 const helper=await response.text();
 result.helper={status:response.status,callSnippets:[...helper.matchAll(/(?:call|excel)\s*[:=]\s*function|(?:call|excel)\s*\([^)]*\)\s*\{/g)].slice(0,12).map(match=>helper.slice(Math.max(0,match.index-150),Math.min(helper.length,match.index+1300)))};
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
   selectOptions:$('select').toArray().slice(0,30).map(el=>({id:clean($(el).attr('id')),options:$(el).find('option').toArray().slice(0,40).map(option=>({value:clean($(option).attr('value')),label:clean($(option).text())}))})),
   forms:$('form').toArray().slice(0,25).map(el=>({method:clean($(el).attr('method')||'GET').toUpperCase(),action:absolute($(el).attr('action')||'',final.href),fields:$(el).find('input[name],select[name],textarea[name]').toArray().slice(0,60).map(field=>({name:clean($(field).attr('name')),type:clean($(field).attr('type')||field.tagName)}))})),
   scripts:$('script[src]').toArray().map(el=>absolute($(el).attr('src'),final.href)).filter(Boolean).slice(0,60),
   candidateLinks:$('a[href]').toArray().filter(el=>/다운로드|엑셀|excel|csv|api|통계/i.test($(el).text()+' '+$(el).attr('href'))).slice(0,40).map(el=>({label:clean($(el).text()),href:absolute($(el).attr('href'),final.href)}))
  };
 }catch(error){result.pages[name]={error:clean(error?.message||'request failed')};}
}
await mkdir('docs',{recursive:true});
await writeFile('docs/aviation-source-probe.json',JSON.stringify(result,null,2)+'\n');
