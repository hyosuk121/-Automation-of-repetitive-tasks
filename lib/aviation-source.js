import {load} from 'cheerio';

// V1.0 guide (2026-08-10): the supplied XML example defines the wire shape.
// No year/month request parameter exists. Never manufacture a historical query.
const endpoint='https://apis.data.go.kr/B551177/operationPerformanceByRoute/getOperationPerformanceByRoute';
const metrics=['flightCount','totalEff','totalNff','totalTrf'];
function fail(message,code='aviation_invalid_response',status=502){throw Object.assign(new Error(message),{code,status});}
export function aviationConfigured(env=process.env){return Boolean(env.INCHEON_API_SERVICE_KEY?.trim());}
export function parseAviationPage(text,{page,regular}){
 if(!text.trim().startsWith('<')) {
  const errors={Unauthorized:'인증키가 유효하지 않습니다. Vercel 환경 변수와 키 활성화 여부를 확인해 주세요.',Forbidden:'해당 API 활용 승인을 확인해 주세요.','API token quota exceeded':'API 일일 호출 한도를 초과했습니다.','API rate limit exceeded':'API 요청이 제한되었습니다. 잠시 후 다시 시도해 주세요.'};
  fail(errors[text.trim()]||'API가 정상 XML 응답을 반환하지 않았습니다.','aviation_provider_error');
 }
 const $=load(text,{xmlMode:true});
 const get=(el,name)=>$(el).children(name).text().trim();
 const header=$('response > header');
 if(header.length!==1||get(header,'resultCode')!=='00')fail('공식 API 응답 코드가 정상이 아닙니다.','aviation_provider_error');
 const body=$('response > body');
 const integer=(value,optional=false)=>{
  if(optional&&value==='')return null;
  if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))fail('응답의 수치 또는 페이지 정보가 올바르지 않습니다.');
  return Number(value);
 };
 const total=integer(get(body,'totalCount')),number=integer(get(body,'pageNo')),size=integer(get(body,'numOfRows'));
 if(number!==page||size<1||size>10000||total>100000)fail('응답 페이지 범위를 확인하지 못했습니다.');
 const rows=[];
 body.find('items > item').each((_,item)=>{
  const row=Object.fromEntries(['yearMonth','airlineIcaoCode','airlineIataCode','airlineName','airportCode','nationCode','nationName','routeCode','routeName','departuresOrArrivals','regularCode','paxCode','tmp1','tmp2','totalFrg','totalTfrg','totalMail','totalBag'].map(k=>[k,get(item,k)]));
  if(!/^\d{4}(0[1-9]|1[0-2])$/.test(row.yearMonth)||!row.nationCode||!row.nationName||!row.airportCode||!(row.airlineIcaoCode||row.airlineIataCode))fail('실적의 기준월 또는 식별 정보가 누락됐습니다.');
  // The specification lists codes, but its example returns Korean labels.
  if(!['D','출발'].includes(row.departuresOrArrivals)||!['Y','여객'].includes(row.paxCode)||![String(regular),regular===0?'정기':'부정기'].includes(row.regularCode))fail('응답의 출발·여객·정기편 조건이 요청과 다릅니다.');
  row.departuresOrArrivals='D';row.paxCode='Y';row.regularCode=regular;
  for(const k of metrics)row[k]=integer(get(item,k),true);
  rows.push(row);
 });
 if(rows.length>size||rows.length>total)fail('API 전체 건수와 응답 행 수가 일치하지 않습니다.');
 return {rows,total,size};
}
export async function inspectAviation({env=process.env,fetcher=fetch}={}){
 if(!aviationConfigured(env))fail('Vercel에 INCHEON_API_SERVICE_KEY를 입력하고 재배포해 주세요.','aviation_not_configured',503);
 let key=env.INCHEON_API_SERVICE_KEY.trim();
 // Accept a portal percent-encoded key without double encoding it in URLSearchParams.
 if(/%[\da-f]{2}/i.test(key)){try{key=decodeURIComponent(key);}catch{fail('인증키 인코딩을 확인해 주세요.','aviation_key_encoding',503);}}
 const signal=AbortSignal.timeout(90000),rows=[],keys=new Map(),groups=[],duplicates={identical:0,different:0,samples:[]};
 for(const regular of [0,1]){
  let expected=null,received=0,page=1,size=null;
  do{
   if(page>100)fail('연결 확인의 최대 페이지 수를 초과했습니다.');
   const url=new URL(endpoint);
   url.search=new URLSearchParams({serviceKey:key,pageNo:String(page),numOfRows:'100',departuresOrArrivals:'D',regularCode:String(regular),paxCode:'Y',type:'xml'});
   let response,text;
   try{
    response=await fetcher(url,{redirect:'error',signal});
    if(!response.ok)fail(response.status===429?'API 요청 한도를 초과했습니다.':`공식 API 연결 실패 (HTTP ${response.status})`,'aviation_http_error');
    // Bound response consumption even if the provider ignores page size.
    text='';let bytes=0;
    const reader=response.body.getReader(),decoder=new TextDecoder();
    try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4000000)fail('API 응답 크기 제한을 초과했습니다.');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
    finally{await reader.cancel().catch(()=>{});}
   }catch(error){if(error.code?.startsWith('aviation_'))throw error;fail('공식 API 연결이 실패하거나 제한 시간을 초과했습니다.','aviation_connection_error');}
   const result=parseAviationPage(text,{page,regular});
   if(expected===null){expected=result.total;size=result.size;}
   if(result.total!==expected||result.size!==size)fail('조회 중 원천 자료의 전체 건수나 페이지 크기가 변경됐습니다. 다시 확인해 주세요.');
   if(result.rows.length!==Math.min(size,expected-received))fail('일부 페이지가 누락되었습니다. 부분 결과를 사용하지 않습니다.');
   for(const [index,row] of result.rows.entries()){
    const id=JSON.stringify([row.yearMonth,row.airlineIcaoCode,row.airlineIataCode,row.airportCode,row.nationCode,row.routeCode,row.regularCode]);
    const first=keys.get(id),location={regularCode:regular,page,row:index+1};
    if(first){
     const identical=JSON.stringify(first.row)===JSON.stringify(row);
     duplicates[identical?'identical':'different']++;
     if(duplicates.samples.length<5){
      const differingFields=Object.keys(row).filter(k=>row[k]!==first.row[k]);
      // Only bounded, documented statistical fields are returned; no raw body or request URL.
      const sample=r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==='string'?v.slice(0,120):v]));
      duplicates.samples.push({kind:identical?'identical':'different',first:{...first.location,values:sample(first.row)},next:{...location,values:sample(row)},differingFields});
     }
    }else keys.set(id,{row,location});
    rows.push(row);
   }
   received+=result.rows.length;page++;
  }while(received<expected);
  groups.push({regularCode:regular,count:received});
 }
 const months=[...new Set(rows.map(r=>r.yearMonth))].sort();
 const countries=[...new Set(rows.map(r=>r.nationName))].sort();
 const needsReview=duplicates.identical+duplicates.different>0;
 const totals=Object.fromEntries(metrics.map(k=>[k,!needsReview&&rows.length&&rows.every(r=>r[k]!==null)?rows.reduce((sum,r)=>sum+r[k],0):null]));
 if(Object.values(totals).some(v=>v!==null&&!Number.isSafeInteger(v)))fail('실적 합계가 안전한 수치 범위를 초과했습니다.');
 return {checkedAt:new Date().toISOString(),status:needsReview?'review_required':rows.length?'received':'empty',duplicates,months,countries,groups,rowCount:rows.length,totals,
  scope:'출발 · 여객편 · 정기 및 부정기. 국제선 여부와 환승 포함 관계는 별도 확인 필요.',
  historicalQuerySupported:false,dailySupported:false};
}
