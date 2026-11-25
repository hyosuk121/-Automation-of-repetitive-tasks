const labels={JP:'일본',VN:'베트남',CN:'중국',TW:'대만',HK:'홍콩',MO:'마카오',TH:'태국',US:'미국'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count=(row,code)=>row?.countries?.find(item=>item.code===code)?.value??0;
const monthLabel=value=>value.slice(0,4)+'.'+value.slice(4);
const dayLabel=value=>value.slice(4,6)+'.'+value.slice(6);
const fmt=value=>value.toLocaleString('ko-KR');
const shiftDay=(period,days)=>{const d=new Date(period.slice(0,4)+'-'+period.slice(4,6)+'-'+period.slice(6)+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10).replaceAll('-','');};
const shiftMonth=(period,months)=>{const d=new Date(period.slice(0,4)+'-'+period.slice(4)+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+months);return d.toISOString().slice(0,7).replaceAll('-','');};
function seasonality(rows,code){
 const available=rows.filter(row=>row.status==='observed'),byPeriod=new Map(available.map(row=>[row.period,row]));
 if(!available.length)return '';
 const max=Math.max(1,...available.map(row=>count(row,code))),lastYear=Math.max(...available.map(row=>Number(row.period.slice(0,4))));
 const years=Array.from({length:Math.max(0,lastYear-2021+1)},(_,i)=>2021+i);
 return `<details class="aviation-details"><summary>월별 계절 패턴 보기 · 미확보 월은 —</summary><div class="table-scroll"><table class="portal-seasonality"><thead><tr><th>연도</th>${Array.from({length:12},(_,i)=>`<th>${i+1}월</th>`).join('')}</tr></thead><tbody>${years.map(year=>`<tr><th>${year}</th>${Array.from({length:12},(_,i)=>{const row=byPeriod.get(String(year)+String(i+1).padStart(2,'0'));if(!row)return '<td>—</td>';const value=count(row,code),opacity=(0.08+0.75*value/max).toFixed(3);return `<td style="background:rgba(78,103,215,${opacity})" title="${year}.${String(i+1).padStart(2,'0')} · ${fmt(value)}명">${fmt(value)}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div><p class="aviation-source-note">색 농도는 선택 국가의 확보 월 중 최댓값 대비 상대 크기입니다. 월별 절대 수치는 각 칸에 표시합니다.</p></details>`;
}
export function windowTotal(rows,code,end,days){
 const map=new Map(rows.map(row=>[row.period,row]));
 let total=0;
 for(let offset=0;offset<days;offset++){
  const row=map.get(shiftDay(end,-offset));
  if(!row||row.status!=='observed')return null;
  total+=count(row,code);
 }
 return total;
}
export async function mountPortal(root,{api,kind,initialCountry='JP',initialSpan}){
 if(!root)return;
 try{
  const data=await api('/aviation/portal');
  if(!root.isConnected)return;
  const rows=(kind==='monthly'?data.monthly:data.daily)||[];
  let country=initialCountry,span=initialSpan??(kind==='monthly'?24:28);
  function render(){
   const current=rows.filter(row=>row.status==='observed').sort((a,b)=>a.period.localeCompare(b.period));
   const latest=current.at(-1)?.period,byPeriod=new Map(rows.map(row=>[row.period,row]));
   const selected=latest?Array.from({length:span},(_,i)=>byPeriod.get(kind==='monthly'?shiftMonth(latest,i-span+1):shiftDay(latest,i-span+1))||{period:kind==='monthly'?shiftMonth(latest,i-span+1):shiftDay(latest,i-span+1),status:'missing'}):[];
   const values=selected.filter(row=>row.status==='observed').map(row=>count(row,country)),max=Math.max(1,...values);
   const title=kind==='monthly'?'인천공항 국제선 출발 · 월간 유임여객':'인천공항 국제선 출발 · 일별 여객';
   const unit=kind==='monthly'?'유임여객':'출발 여객';
   const recent=latest&&kind==='daily'?windowTotal(current,country,latest,7):null;
   const previous=latest&&kind==='daily'?windowTotal(current,country,shiftDay(latest,-7),7):null;
   const bars=selected.map(row=>{const available=row.status==='observed',value=available?count(row,country):null;return `<div class="portal-bar" title="${esc(kind==='monthly'?monthLabel(row.period):dayLabel(row.period))} · ${available?fmt(value)+'명':'미확보'}"><strong>${available?fmt(value):'—'}</strong><div class="portal-bar-track">${available?`<span style="height:${Math.max(2,100*value/max)}%"></span>`:''}</div><small>${esc(kind==='monthly'?monthLabel(row.period):dayLabel(row.period))}</small></div>`;}).join('');
   const missingText=kind==='monthly'?'2021년부터 확인 가능한 월을 차례로 수집합니다.':'공개 시차를 고려해 최근 날짜를 확인합니다. 확인되지 않은 날짜는 0으로 표시하지 않습니다.';
   const reviewCount=rows.filter(row=>row.status==='review_required').length;
   const lastCheck=(data.checks||[]).find(check=>check.kind===kind);
   const checkLabel={succeeded:'자료 저장',unavailable:'원천 미공개 · 재확인 예정',failed:'확인 실패 · 재시도 예정',running:'확인 중'}[lastCheck?.status]||'확인 기록 없음';
   const checkedAt=lastCheck?.last_checked_at?new Date(lastCheck.last_checked_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'';
   const coverage=`<div class="portal-coverage" role="status"><div><span>확보 범위</span><strong>${rows.length}${kind==='monthly'?'개월':'일'}</strong><small>${rows.length?esc(kind==='monthly'?monthLabel(rows.at(-1).period)+' ~ '+monthLabel(rows[0].period):rows.at(-1).period+' ~ '+rows[0].period):'아직 자료 없음'}</small></div><div><span>검토 필요</span><strong>${reviewCount}건</strong><small>미확보 자료는 포함하지 않음</small></div><div><span>최근 자동 확인</span><strong>${esc(checkLabel)}</strong><small>${lastCheck?esc(lastCheck.period)+' · '+esc(checkedAt):'자동 수집 실행을 기다리는 중'}</small></div></div>`;
   root.innerHTML=`<div class="panel-heading"><div><h2>${title}</h2><p>항공정보포털 공개 통계 · ${kind==='monthly'?'실적월':'실적일'} 기준 · ${unit}</p></div><button class="button secondary" data-portal-process>자료 수집 실행</button></div><div class="aviation-preview-body"><p class="aviation-source-note">자동 수집은 화면을 닫아도 계속 진행됩니다. 수동 실행은 1분에 한 번 가능합니다.</p><p role="status" class="portal-process-status"></p><div class="aviation-portal-controls"><label>국가·지역 <select id="portal-country">${Object.entries(labels).map(([code,name])=>`<option value="${code}" ${code===country?'selected':''}>${name}</option>`).join('')}</select></label><label>표시 기간 <select id="portal-span">${(kind==='monthly'?[12,24,48,72]:[7,28,56]).map(n=>`<option value="${n}" ${n===span?'selected':''}>최근 ${n}${kind==='monthly'?'개월':'일'}</option>`).join('')}</select></label></div>${coverage}${latest?`<p class="aviation-source-note">최근 확보 ${kind==='monthly'?'실적월':'실적일'}: ${esc(kind==='monthly'?monthLabel(latest):latest.slice(0,4)+'.'+dayLabel(latest))} · 단위: 명</p>`:''}${kind==='daily'&&recent!==null&&previous!==null?`<div class="aviation-kpis"><div><span>최근 7일</span><strong>${fmt(recent)}명</strong></div><div><span>직전 7일</span><strong>${fmt(previous)}명</strong></div><div><span>차이</span><strong>${fmt(recent-previous)}명</strong></div><div><span>자료 기준</span><strong>${dayLabel(latest)}</strong></div></div>`:''}${bars?`<div class="portal-bars" aria-label="${esc(labels[country])} ${unit} 추이">${bars}</div>`:`<p class="aviation-empty">아직 확인된 ${kind==='monthly'?'월간':'일별'} 자료가 없습니다. 자동 수집 후 여기에 표시됩니다.</p>`}${kind==='monthly'?seasonality(rows,country):''}${kind==='monthly'&&rows.length>=12?`<details class="aviation-details"><summary>월별 자료 표 보기</summary><div class="table-scroll"><table><thead><tr><th>실적월</th><th>${esc(labels[country])} 유임여객</th><th>품질</th></tr></thead><tbody>${rows.slice().sort((a,b)=>b.period.localeCompare(a.period)).map(row=>`<tr><td>${monthLabel(row.period)}</td><td>${row.status==='observed'?fmt(count(row,country)):'—'}</td><td>${row.status==='observed'?'확인':'검토 필요'}</td></tr>`).join('')}</tbody></table></div></details>`:''}<p class="aviation-source-note">${missingText} ${kind==='monthly'?'일별 여객과 유임여객은 서로 합산하지 않습니다.':'최근 7일·직전 7일 합계는 14일 모두 확보된 경우에만 계산합니다.'}</p></div>`;
   root.querySelector('[data-portal-process]').onclick=async event=>{const button=event.currentTarget;button.disabled=true;button.textContent='자료 확인 중…';try{const result=await api('/aviation/portal/process',{method:'POST',body:'{}'});await mountPortal(root,{api,kind,initialCountry:country,initialSpan:span});const status=root.querySelector('.portal-process-status');if(status)status.textContent=`일별: ${result.daily?.period||'대기'} (${result.daily?.status||result.status}) · 월간: ${result.monthly?.period||'대기'} (${result.monthly?.status||result.status})`; }catch(error){const status=root.querySelector('.portal-process-status');if(status)status.textContent=error.message;button.disabled=false;button.textContent='자료 수집 실행';}};
   root.querySelector('#portal-country').onchange=e=>{country=e.target.value;render();};
   root.querySelector('#portal-span').onchange=e=>{span=Number(e.target.value);render();};
  }
  render();
 }catch(error){if(root.isConnected)root.textContent=error.message;}
}
