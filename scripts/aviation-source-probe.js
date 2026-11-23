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
   forms:$('form').toArray().slice(0,25).map(el=>({method:clean($(el).attr('method')||'GET').toUpperCase(),action:absolute($(el).attr('action')||'',final.href),fields:$(el).find('input[name],select[name],textarea[name]').toArray().slice(0,60).map(field=>({name:clean($(field).attr('name')),type:clean($(field).attr('type')||field.tagName)}))})),
   scripts:$('script[src]').toArray().map(el=>absolute($(el).attr('src'),final.href)).filter(Boolean).slice(0,60),
   candidateLinks:$('a[href]').toArray().filter(el=>/다운로드|엑셀|excel|csv|api|통계/i.test($(el).text()+' '+$(el).attr('href'))).slice(0,40).map(el=>({label:clean($(el).text()),href:absolute($(el).attr('href'),final.href)}))
  };
 }catch(error){result.pages[name]={error:clean(error?.message||'request failed')};}
}
await mkdir('docs',{recursive:true});
await writeFile('docs/aviation-source-probe.json',JSON.stringify(result,null,2)+'\n');
