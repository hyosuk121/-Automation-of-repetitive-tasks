import {summarizeRows,isPriorityCountry} from './aviation-dashboard.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const monthLabel=m=>/^\d{6}$/.test(m)?`${m.slice(0,4)}.${m.slice(4)}`:m;
const date=v=>new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
const statusLabel={succeeded:'성공',failed:'실패',running:'진행 중',pending:'대기 중'};
const checkDay=value=>String(value||'').slice(0,10).replaceAll('-','.');
export function recentMonths(archives){
 return [...new Set(archives.flatMap(a=>a.months||[]))].filter(m=>/^\d{6}$/.test(m)).sort().reverse();
}
export async function mountRecent(root,{api}){
 root.textContent='최근 관측 자료를 불러오는 중…';
 try{
  const {archives,monthArchives,checks}=await api('/aviation/archives');
  if(!root.isConnected)return;
  const monthly=monthArchives||archives,months=recentMonths(monthly);
  const table=archives.length?`<div class="table-scroll"><table><thead><tr><th>원천 실적월</th><th>응답 행</th><th>품질</th><th>최근 확인</th></tr></thead><tbody>${archives.slice(0,12).map(a=>`<tr><td>${(a.months||[]).map(monthLabel).map(esc).join(', ')||'미확인'}</td><td>${a.row_count}</td><td>${a.quality==='review_required'?'검토 필요':'응답 검증 완료'}</td><td>${esc(date(a.last_seen_at))}</td></tr>`).join('')}</tbody></table></div>`:'<p>보관된 월간 응답이 없습니다.</p>';
  const checksText=checks?.length?`<p>월간 API 자동 확인일: ${esc(checkDay(checks[0].check_day))} · ${esc(statusLabel[checks[0].status]||checks[0].status)} (실적일이 아닙니다)</p>`:'';
  root.innerHTML=`<div class="aviation-recent-intro"><p>이 화면은 <strong>월간 원천 실적</strong>의 최근 확보 상태를 보여줍니다. 보관 시각은 실적월과 다릅니다.</p>${checksText}</div><div id="aviation-comparison"></div><details class="aviation-details"><summary>최근 보관 응답 보기</summary>${table}</details>`;
  const comparison=root.querySelector('#aviation-comparison');
  if(months.length<2){comparison.innerHTML='<div class="aviation-empty">비교 가능한 서로 다른 실적월이 아직 2개월 미만입니다. 다음 월의 공식 응답이 보관되면 나란히 표시합니다.</div>';return;}
  const pair=months.slice(0,2),records=pair.map(month=>monthly.find(a=>a.months.includes(month)));
  comparison.textContent='최근 두 실적월을 비교하는 중…';
  const [current,previous]=await Promise.all(records.map(a=>api('/aviation/archives/'+a.id)));
  if(!comparison.isConnected)return;
  const summaries=[summarizeRows(current.source_rows||[],pair[0]),summarizeRows(previous.source_rows||[],pair[1])];
  const countries=new Map(summaries.flatMap(s=>s.countries.filter(c=>isPriorityCountry(c.name))).map(c=>[c.code,c.name]));
  const codes=[...countries.keys()].sort((a,b)=>countries.get(a).localeCompare(countries.get(b),'ko'));
  const value=(summary,code)=>{const match=summary.countries.find(c=>c.code===code);return match?.included?match.paid.toLocaleString('ko-KR'):'—';};
  comparison.innerHTML=`<div class="aviation-section-heading"><h3>최근 두 실적월 · 주요 국가 관측값</h3><span>유임승객 부분합 · 명</span></div><p>각 월의 확인 가능한 행만 합산했습니다. 빠진 행의 범위가 달라 증감률은 계산하지 않습니다.</p><div class="table-scroll"><table><thead><tr><th>국가·지역</th><th>${esc(monthLabel(pair[1]))}</th><th>${esc(monthLabel(pair[0]))}</th></tr></thead><tbody>${codes.map(code=>`<tr><td>${esc(countries.get(code))}</td><td>${value(summaries[1],code)}</td><td>${value(summaries[0],code)}</td></tr>`).join('')||'<tr><td colspan="3">기본 관심 국가의 자료가 없습니다.</td></tr>'}</tbody></table></div><p class="aviation-source-note">제외 행: ${esc(monthLabel(pair[1]))} ${summaries[1].excluded}행 · ${esc(monthLabel(pair[0]))} ${summaries[0].excluded}행. ‘—’는 미확보 또는 집계 불가이며 0명이 아닙니다.</p>`;
 }catch(error){if(root.isConnected)root.textContent=error.message;}
}
