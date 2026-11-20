const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>/^\d+$/.test(String(v))&&Number.isSafeInteger(Number(v))?Number(v):null;
export function summarizeRows(rows,month){
 const selected=rows.filter(r=>r.yearMonth===month),keys=new Map();
 const key=r=>JSON.stringify([r.yearMonth,r.airlineIcaoCode,r.airlineIataCode,r.airportCode,r.nationCode,r.routeCode,r.regularCode]);
 for(const r of selected)keys.set(key(r),(keys.get(key(r))||0)+1);
 const countries=new Map();let excluded=0;
 const detail=selected.map(r=>{
  const reason=!r.nationCode||!r.nationName?'국가 누락':keys.get(key(r))>1?'동일 조건 복수 행':!['D','출발'].includes(r.departuresOrArrivals)||!['Y','여객'].includes(r.paxCode)?'집계 조건 확인 필요':!['0','1','정기','부정기'].includes(String(r.regularCode))?'정기 구분 확인 필요':!r.airportCode||!(r.airlineIcaoCode||r.airlineIataCode)?'식별값 누락':number(r.totalEff)===null?'유임 수치 누락/오류':'';
  const name=r.nationName||'국가 미분류';if(!countries.has(name))countries.set(name,{name,paid:0,included:0,excluded:0});const c=countries.get(name);
  if(reason){excluded++;c.excluded++;}else{c.paid+=number(r.totalEff);c.included++;}
  return {...r,reason};
 });
 return {rows:detail,countries:[...countries.values()].sort((a,b)=>b.paid-a.paid),excluded,total:selected.length};
}
export async function mountDashboard(root,{api,archives,month}){
 const available=[...new Set(archives.flatMap(a=>a.months))].sort().reverse();
 const chosen=month?month.replace('-',''):available[0];
 const archive=archives.find(a=>a.months.includes(chosen));
 if(!archive){root.innerHTML='<p>이 기간에 보관된 자료가 없습니다.</p>';return;}
 root.textContent='국가별 자료를 불러오는 중…';
 try{
  const data=await api('/aviation/archives/'+archive.id);if(!root.isConnected)return;
  const summary=summarizeRows(data.source_rows,chosen);let country='';
  function draw(){
   const visible=summary.countries.filter(c=>!country||c.name===country),max=Math.max(1,...visible.map(c=>c.paid));
   root.innerHTML=`<div class="panel-heading"><div><h2>${esc(chosen.slice(0,4)+'.'+chosen.slice(4))} 국가별 관측</h2><p>최신 보관 응답 기준 · 인천공항 출발 여객편 · 정기/부정기</p></div><label>국가 <select id="aviation-country"><option value="">전체</option>${summary.countries.map(c=>`<option ${c.name===country?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label></div><div class="help-content"><div class="stats-grid"><div class="stat-card"><span>응답 행</span><strong>${summary.total}</strong></div><div class="stat-card"><span>합산 대상 행</span><strong>${summary.total-summary.excluded}</strong></div><div class="stat-card"><span>제외 행</span><strong>${summary.excluded}</strong></div><div class="stat-card"><span>국가·지역 그룹</span><strong>${summary.countries.length}</strong></div></div><div class="notice"><p>검토용 부분집계입니다. 국가 누락·동일 조건 복수 행 등은 모두 제외합니다. 막대는 <strong>유임승객(totalEff)만</strong> 더한 값이며 총여객 수나 eSIM 수요가 아닙니다. 국제선 범위 및 환승 포함 관계는 미확정입니다.</p></div><h3>국가별 유임승객 부분합 (명)</h3>${visible.map(c=>`<div style="margin:14px 0"><div style="display:flex;justify-content:space-between;gap:12px"><span>${esc(c.name)}${c.excluded?' · 제외 행 있음':''}</span><strong>${c.included?c.paid.toLocaleString():'집계 불가'}</strong></div><meter style="width:100%;height:20px" min="0" max="${max}" value="${c.paid}" aria-label="${esc(c.name)} 유임승객 부분합">${c.paid}</meter></div>`).join('')}<div class="table-scroll"><table><thead><tr><th>국가·지역</th><th>유임승객 부분합</th><th>포함 행</th><th>제외 행</th></tr></thead><tbody>${visible.map(c=>`<tr><td>${esc(c.name)}</td><td>${c.included?c.paid.toLocaleString():'—'}</td><td>${c.included}</td><td>${c.excluded}</td></tr>`).join('')}</tbody></table></div><h3>월별 추이·계절성</h3><p>보관된 월: ${available.map(esc).join(', ')}. 과거 동일 기준 자료 확보 및 집계 검증 전에는 추이·증감률·계절성을 계산하지 않습니다.</p><details><summary>원천 행과 제외 이유 확인</summary><div class="table-scroll" style="max-height:440px"><table><thead><tr><th>국가</th><th>항공사</th><th>공항</th><th>운항편수</th><th>유임</th><th>무임</th><th>환승</th><th>처리</th></tr></thead><tbody>${summary.rows.filter(r=>!country||(r.nationName||'국가 미분류')===country).map(r=>`<tr><td>${esc(r.nationName||'미분류')}</td><td>${esc(r.airlineName)}</td><td>${esc(r.airportCode)}</td><td>${esc(r.flightCount||'—')}</td><td>${esc(r.totalEff||'—')}</td><td>${esc(r.totalNff||'—')}</td><td>${esc(r.totalTrf||'—')}</td><td>${esc(r.reason||'부분합 포함')}</td></tr>`).join('')}</tbody></table></div></details></div>`;
   root.querySelector('#aviation-country').onchange=e=>{country=e.target.value;draw();};
  }
  draw();
 }catch(e){if(root.isConnected)root.textContent=e.message;}
}
