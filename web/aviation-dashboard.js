const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>/^\d+$/.test(String(v))&&Number.isSafeInteger(Number(v))?Number(v):null;
const formatted=v=>v.toLocaleString('ko-KR');
const monthLabel=m=>/^\d{6}$/.test(m)?`${m.slice(0,4)}.${m.slice(4)}`:m;
const missing='__missing__';

export function summarizeRows(rows,month){
 const selected=rows.filter(r=>r.yearMonth===month),identities=new Map(),countries=new Map(),reasons=new Map();
 const identity=r=>JSON.stringify([r.yearMonth,r.airlineIcaoCode,r.airlineIataCode,r.airportCode,r.nationCode,r.routeCode,r.regularCode]);
 for(const row of selected)identities.set(identity(row),(identities.get(identity(row))||0)+1);
 let excluded=0;
 const detail=selected.map(r=>{
  const code=String(r.nationCode||'').trim(),name=String(r.nationName||'').trim()||'국가 미분류',countryKey=code||missing;
  if(!countries.has(countryKey))countries.set(countryKey,{code:countryKey,name,paid:0,included:0,excluded:0});
  const country=countries.get(countryKey),paid=number(r.totalEff);
  let reason=!code||name==='국가 미분류'?'국가 누락':identities.get(identity(r))>1?'동일 조건 복수 행':!['D','출발'].includes(r.departuresOrArrivals)||!['Y','여객'].includes(r.paxCode)?'집계 조건 확인 필요':!['0','1','정기','부정기'].includes(String(r.regularCode))?'정기 구분 확인 필요':!r.airportCode||!(r.airlineIcaoCode||r.airlineIataCode)?'식별값 누락':paid===null?'유임 수치 누락/오류':'';
  if(!reason&&!Number.isSafeInteger(country.paid+paid))reason='합계 범위 초과';
  if(reason){excluded++;country.excluded++;reasons.set(reason,(reasons.get(reason)||0)+1);}
  else{country.paid+=paid;country.included++;}
  return {...r,reason,countryKey};
 });
 return {rows:detail,countries:[...countries.values()].sort((a,b)=>b.paid-a.paid||a.name.localeCompare(b.name,'ko')),excluded,total:selected.length,reasons:[...reasons].sort((a,b)=>b[1]-a[1])};
}

export async function mountDashboard(root,{api,archives,month}){
 const available=[...new Set(archives.flatMap(a=>a.months||[]))].sort().reverse();
 const chosen=month?month.replace('-',''):available[0];
 const archive=archives.find(a=>a.months.includes(chosen));
 if(!archive){root.innerHTML='<div class="aviation-empty">이 월에 보관된 응답이 없습니다. 확보된 월을 선택해 주세요.</div>';return;}
 root.textContent='국가별 관측 자료를 불러오는 중…';
 try{
  const data=await api('/aviation/archives/'+archive.id);
  if(!root.isConnected)return;
  const summary=summarizeRows(data.source_rows||[],chosen);
  let country='all';
  function draw(){
   const visible=summary.countries.filter(c=>country==='all'||c.code===country);
   const included=visible.reduce((n,c)=>n+c.included,0),excluded=visible.reduce((n,c)=>n+c.excluded,0);
   const max=Math.max(1,...visible.map(c=>c.paid));
   const bars=visible.filter(c=>c.included).map(c=>`<div class="aviation-bar-row"><div class="aviation-bar-caption"><span>${esc(c.name)} <small>${esc(c.code===missing?'국가 코드 없음':c.code)}</small>${c.excluded?'<em>제외 행 있음</em>':''}</span><strong>${formatted(c.paid)}명</strong></div><div class="aviation-bar-track"><span style="width:${Math.max(0.4,100*c.paid/max)}%"></span></div></div>`).join('');
   root.innerHTML=`<div class="panel-heading aviation-preview-heading"><div><h2>${esc(monthLabel(chosen))} 국가별 관측</h2><p>인천공항 출발 여객편 · 정기/부정기 · 해당 월의 마지막 보관 응답</p></div><label>국가·지역 <select id="aviation-country"><option value="all" ${country==='all'?'selected':''}>전체 국가</option>${summary.countries.map(c=>`<option value="${esc(c.code)}" ${country===c.code?'selected':''}>${esc(c.name)}${c.code===missing?' · 미분류':''}</option>`).join('')}</select></label></div><div class="aviation-preview-body"><div class="aviation-quality"><strong>검토용 유임승객 부분합</strong><p>확인할 수 없는 행은 제외했습니다. 이 값은 확정 총여객 수나 eSIM 수요가 아닙니다. 국제선 범위와 환승 포함 관계도 확인 중입니다.</p></div><div class="aviation-kpis"><div><span>${country==='all'?'전체 응답':'선택 국가 응답'}</span><strong>${country==='all'?formatted(summary.total):formatted(included+excluded)}행</strong></div><div><span>부분합에 포함</span><strong>${formatted(included)}행</strong></div><div><span>제외</span><strong>${formatted(excluded)}행</strong></div><div><span>국가·지역</span><strong>${formatted(country==='all'?summary.countries.length:visible.length)}개</strong></div></div><div class="aviation-section-heading"><h3>국가별 유임승객 부분합</h3><span>단위: 명 · 제외 행 미포함</span></div>${bars||'<p class="aviation-empty">이 조건에 집계 가능한 행이 없습니다.</p>'}<details class="aviation-details"><summary>국가별 수치 표 보기</summary><div class="table-scroll"><table><thead><tr><th>국가·지역</th><th>유임승객 부분합</th><th>포함 행</th><th>제외 행</th></tr></thead><tbody>${visible.map(c=>`<tr><td>${esc(c.name)}</td><td>${c.included?formatted(c.paid):'—'}</td><td>${c.included}</td><td>${c.excluded}</td></tr>`).join('')}</tbody></table></div></details><details class="aviation-details"><summary>제외 사유 확인 · ${formatted(summary.excluded)}행</summary><ul>${summary.reasons.map(([reason,count])=>`<li>${esc(reason)}: ${formatted(count)}행</li>`).join('')||'<li>제외된 행이 없습니다.</li>'}</ul></details><details class="aviation-details"><summary>원천 행 확인 · ${country==='all'?formatted(summary.total):formatted(included+excluded)}행</summary><div class="table-scroll aviation-source-table"><table><thead><tr><th>국가</th><th>항공사</th><th>공항</th><th>편수</th><th>유임</th><th>무임</th><th>환승</th><th>처리</th></tr></thead><tbody>${summary.rows.filter(r=>country==='all'||r.countryKey===country).map(r=>`<tr><td>${esc(r.nationName||'미분류')}</td><td>${esc(r.airlineName)}</td><td>${esc(r.airportCode)}</td><td>${esc(r.flightCount||'0')}</td><td>${esc(r.totalEff||'0')}</td><td>${esc(r.totalNff||'0')}</td><td>${esc(r.totalTrf||'0')}</td><td>${esc(r.reason||'부분합 포함')}</td></tr>`).join('')}</tbody></table></div></details><p class="aviation-source-note">확보된 실적월: ${available.map(monthLabel).map(esc).join(' · ')}. 동일 기준의 과거 자료가 충분하지 않아 추이·계절성은 아직 산출하지 않습니다.</p></div>`;
   root.querySelector('#aviation-country').onchange=e=>{country=e.target.value;draw();};
  }
  draw();
 }catch(error){if(root.isConnected)root.textContent=error.message;}
}
