import {mountDashboard} from './aviation-dashboard.js';
import {mountPersonal} from './aviation-personal.js';
import {mountRecent} from './aviation-recent.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let tab='market',month='',selectedCountries=null;
let activeOwner=null;
export function aviationView(user){
 return `<div class="workspace"><aside class="sidebar"><a class="brand" href="/" data-home><img class="brand-icon" src="/automation-icon.svg" alt=""><span>Hyoseok's<br>Automation</span></a><a class="back-link" href="/" data-home>← 모든 도구</a><div class="nav-section-label">AVIATION INSIGHTS</div><nav>${[['market','시장·계절 패턴'],['recent','최근 변화']].map(([id,label])=>`<button class="nav-item ${tab===id?'selected':''}" data-aviation-tab="${id}">${label}</button>`).join('')}</nav><div class="sidebar-bottom"><button class="nav-item" data-login>${user?'로그아웃':'관리자 로그인'}</button></div></aside><div class="workspace-body"><header class="topbar"><button class="icon-button mobile-menu" data-menu aria-label="메뉴 열기">☰</button><div class="breadcrumbs">항공 데이터 자동화 / 인천공항</div></header><main class="content"><div class="page-heading"><div><div class="eyebrow">INCHEON · MONTHLY OBSERVATIONS</div><h1>${tab==='market'?'시장·계절 패턴':'최근 변화'}</h1><p>공식 실적의 기준과 확보 범위를 확인하세요.</p></div>${user?'<button class="button primary" data-aviation-check>조회·응답 보관</button>':''}</div>${tab==='recent'?'<section class="data-panel"><div class="panel-heading"><h2>최근 월간 응답</h2></div><div id="aviation-recent" class="help-content">월간 응답을 불러오는 중…</div></section><section class="data-panel help-content"><h2>일별 변화</h2><p>현재 공식 연계 API는 월간 실적만 제공합니다. 일별 자료가 연결되면 실적일 기준 7일·28일 비교를 제공합니다.</p></section>':`<div class="notice"><div><strong>집계 기준 검토 중</strong><p>국가 정보 누락 및 동일 조건의 복수 행을 보존하고 있습니다. 검토용 대시보드는 확인이 필요한 행을 제외한 유임승객 부분합만 제공합니다. 확정 여객 합계·증감률·계절성은 제공하지 않습니다. 항공 여객수는 eSIM 수요와 동일하지 않습니다.</p></div></div><section class="data-panel"><div class="panel-heading"><h2>확보된 월간 응답</h2><button class="button secondary" data-aviation-reload>새로고침</button></div><div class="table-toolbar"><label>실적월 <select id="aviation-month"><option value="">확보 월 불러오는 중…</option></select></label><span class="muted-text">수집 날짜가 아닌 원천 실적월 기준</span></div><div id="aviation-months" class="help-content">${user?'불러오는 중…':'공개할 수 있는 검증된 통계가 아직 없습니다. 원천 응답 보관 내역은 관리자 로그인 후 확인할 수 있습니다.'}</div></section><section class="data-panel help-content"><h2>분석 제공 범위</h2><p>목표 기간: 2021년부터 최신 공개월. 현재 API는 과거 연월을 지정할 수 없어 실제 확보된 월만 조회합니다.</p><p>기본 관심 지역: 일본 · 베트남 · 중국 · 대만 · 홍콩 · 마카오 · 태국 · 미국</p><p>출발 · 여객편 · 정기/부정기 응답. 국제선 구분과 유임·무임·환승 포함 관계는 검토 중입니다.</p><a class="text-button" href="https://www.data.go.kr/data/15160910/openapi.do" target="_blank" rel="noopener noreferrer">공식 데이터 출처 ↗</a></section>`}${user?'<section class="data-panel help-content" id="aviation-personal">개인 기록을 불러오는 중…</section>':''}</main></div></div>`;
}
export function bindAviation({user,api,render}){
 const owner=user?.id??null;
 if(owner!==activeOwner){tab='market';month='';selectedCountries=null;activeOwner=owner;render();return;}
 const recent=document.querySelector('#aviation-recent');if(recent&&user)void mountRecent(recent,{api});else if(recent)recent.textContent='관리자 로그인 후 보관된 월간 응답을 확인할 수 있습니다.';
 const personal=document.querySelector('#aviation-personal');if(personal&&user)void mountPersonal(personal,{api,context:()=>({tab,month,countries:selectedCountries}),apply:p=>{tab=p.tab;month=p.month;selectedCountries=p.countries;render();}});
 document.querySelectorAll('[data-aviation-tab]').forEach(el=>el.onclick=()=>{tab=el.dataset.aviationTab;render();});
 const input=document.querySelector('#aviation-month');if(input)input.onchange=()=>{month=input.value;void refresh();};
 document.querySelector('[data-aviation-reload]')?.addEventListener('click',refresh);
 async function refresh(){
  const target=document.querySelector('#aviation-months');if(!target||!user)return;
  document.querySelector('[data-observed-dashboard]')?.remove();
  const selected=month;target.textContent='불러오는 중…';
  try{const {archives}=await api('/aviation/archives');if(!target.isConnected||selected!==month)return;
   const available=[...new Set(archives.flatMap(a=>a.months||[]))].filter(m=>/^\d{6}$/.test(m)).sort().reverse();
   input.innerHTML='<option value="">최신 확보 월</option>'+available.map(m=>`<option value="${m.slice(0,4)}-${m.slice(4)}">${m.slice(0,4)}.${m.slice(4)}</option>`).join('');
   if(month&&!available.includes(month.replace('-','')))input.innerHTML+=`<option value="${esc(month)}">${esc(month)} · 미확보</option>`;
   input.value=month;
   const dashboard=document.createElement('section');dashboard.className='aviation-preview';document.querySelector('[data-observed-dashboard]')?.remove();dashboard.dataset.observedDashboard='';target.before(dashboard);void mountDashboard(dashboard,{api,archives,month:selected});
   const rows=archives.filter(a=>!month||a.months.includes(month.replace('-','')));
   target.innerHTML=rows.length?`<p>최근 보관 응답 최대 50건에서 조회합니다. 같은 월의 여러 응답은 정정 또는 변경 관측이며 서로 합산하지 않습니다.</p><div class="table-scroll"><table><thead><tr><th>실적월</th><th>응답 행 수</th><th>품질</th><th>최초 보관</th><th>최근 확인</th></tr></thead><tbody>${rows.map(a=>`<tr><td>${a.months.map(esc).join(', ')||'미확인'}</td><td>${a.row_count}</td><td>${a.quality==='review_required'?'검토 필요':'응답 검증 완료 · 집계 검토 중'}</td><td>${esc(new Date(a.first_seen_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))}</td><td>${esc(new Date(a.last_seen_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))}</td></tr>`).join('')}</tbody></table></div>`:'<p>해당 조건에서 확인되는 보관 응답이 없습니다. 미확보 자료를 0으로 표시하지 않습니다.</p>';
  }catch(e){if(target.isConnected)target.textContent=e.message;}
 }
 void refresh();
}
