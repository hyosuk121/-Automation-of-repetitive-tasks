import airports from './data/airport-countries.json' with {type:'json'};
const origin='https://www.airportal.go.kr';
const source={
 monthly:'/stats/transport/getDetailedAirTransportStats3.do',
 daily:'/stats/transport/selectDailyStatisticsByRoute.do'
};
const safeNumber=value=>/^(0|[1-9]\d*)$/.test(String(value))&&Number.isSafeInteger(Number(value))?Number(value):null;
const error=(message,code)=>Object.assign(new Error(message),{code,status:502});
export const validPortalPeriod=(kind,period)=>kind==='monthly'?/^20\d{2}(0[1-9]|1[0-2])$/.test(period):kind==='daily'?/^20\d{2}(0[1-9]|1[0-2])([0-2]\d|3[01])$/.test(period):false;
export async function fetchPortal(kind,period,{fetcher=fetch}={}){
 if(!validPortalPeriod(kind,period))throw Object.assign(new Error('실적 기간 형식이 올바르지 않습니다.'),{status:400});
 const body=kind==='monthly'?{last_yearmonth:period,this_yearmonth:period,sn_gubun:'total',airport_gubun:'ICN',pass_gubun:'1',carge_gubun:'total',forreign_airport_gubun:'total',di_gubun:'I',arvl_type:'D',pyn_gubun:'Y'}:{startDt:period,endDt:period,koreaAirport:'RKSI',airlineType:'I'};
 let response;
 try{response=await fetcher(origin+source[kind],{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json;charset=UTF-8','Accept':'application/json','request-call':'web-rest','Origin':origin,'Referer':origin+(kind==='monthly'?'/stats/transport/chartDetail3.do':'/stats/transport/dailyRoute.do')},body:JSON.stringify(body)});}
 catch{throw error('항공포털 공개 통계 연결에 실패했습니다.','airportal_connection');}
 if(!response.ok)throw error('항공포털 통계 응답 상태를 확인해 주세요.','airportal_http');
 if(!String(response.headers.get('content-type')||'').includes('json'))throw error('항공포털이 JSON 통계를 반환하지 않았습니다.','airportal_format');
 let bytes=0,text='';const reader=response.body.getReader(),decoder=new TextDecoder();
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2000000)throw error('항공포털 응답이 너무 큽니다.','airportal_size');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}
 let payload;try{payload=JSON.parse(text);}catch{throw error('항공포털 응답을 해석하지 못했습니다.','airportal_format');}
 if(String(payload.resultCode)!=='200'||!Array.isArray(payload.content)||payload.content.length>5000)throw error('항공포털 통계 응답을 확인해 주세요.','airportal_response');
 if(!payload.content.length)return {kind,period,metric:kind==='monthly'?'paid_departures':'daily_departures',status:'unavailable',rows:[],countries:[],total:null,unmapped:0};
 if(kind==='monthly'&&payload.content.length===1&&payload.content[0].code_name==='전체 합계'&&payload.content[0].pass==null)return {kind,period,metric:'paid_departures',status:'unavailable',rows:[],countries:[],total:null,unmapped:0};
 const countries=new Map(),rows=[];let total=null,unmapped=0,sum=0;
 for(const raw of payload.content){
  if(kind==='monthly'&&raw.airport_name==null){
   if(raw.code_name!=='전체 합계'||total!==null)throw error('월간 합계 행을 확인하지 못했습니다.','airportal_scope');
   total=safeNumber(raw.pass);if(total===null)throw error('월간 합계 수치가 올바르지 않습니다.','airportal_number');
   continue;
  }
  const airport=kind==='monthly'?String(raw.airport_name||'').match(/\(([A-Z]{3})\)$/)?.[1]:String(raw.ap_ROUTE||'');
  const value=safeNumber(kind==='monthly'?raw.pass:raw.dep_PERSON);
  if(value===null||!airport)throw error('노선 여객 수치 또는 공항 코드가 올바르지 않습니다.','airportal_number');
  if(kind==='monthly'&&raw.code_name!=='인천(ICN)')throw error('월간 자료의 출발 공항이 다릅니다.','airportal_scope');
  if(kind==='daily'&&!String(raw.ap1||'').includes('RKSI'))throw error('일별 자료의 출발 공항이 다릅니다.','airportal_scope');
  const country=airports[kind==='monthly'?'iata':'icao'][airport]||null;
  if(!country)unmapped++;else{
   const old=countries.get(country)||0;
   if(!Number.isSafeInteger(old+value))throw error('국가별 합계 범위를 초과했습니다.','airportal_number');
   countries.set(country,old+value);
  }
  if(!Number.isSafeInteger(sum+value))throw error('합계 범위를 초과했습니다.','airportal_number');
  sum+=value;rows.push({airport,country,value,airline:kind==='daily'?String(raw.al_ICAO||''):null});
 }
 if(kind==='monthly'&&total===null)throw error('월간 전체 합계가 없습니다.','airportal_scope');
 return {kind,period,metric:kind==='monthly'?'paid_departures':'daily_departures',status:unmapped||kind==='monthly'&&sum!==total?'review_required':'observed',rows,countries:[...countries].map(([code,value])=>({code,value})).sort((a,b)=>b.value-a.value),total,unmapped};
}
