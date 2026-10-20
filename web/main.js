import { createIcons, ArrowRight, ArrowLeft, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, LayoutGrid, ChartNoAxesCombined, Plane, Clock3, Settings2, Search, Plus, RefreshCw, Download, X, LogOut, ShieldCheck, CircleHelp, ExternalLink, Pencil, Archive, Check, AlertCircle, Database, Menu, GripVertical, Layers, Zap, CalendarDays } from 'lucide';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/600.css';
import '@fontsource/noto-sans-kr/700.css';
import './styles.css';

const icons={ArrowRight,ArrowLeft,ChevronLeft,ChevronRight,ChevronUp,ChevronDown,LayoutGrid,ChartNoAxesCombined,Plane,Clock3,Settings2,Search,Plus,RefreshCw,Download,X,LogOut,ShieldCheck,CircleHelp,ExternalLink,Pencil,Archive,Check,AlertCircle,Database,Menu,GripVertical,Layers,Zap,CalendarDays};
const $=s=>document.querySelector(s);
const state={user:null,config:null,competitors:[],runs:[],page:'dashboard',platform:'app_store',search:'',scope:'all',status:'all',archived:false,selectedCard:0,busy:false,runOffset:0};
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=(name,cls='')=>`<i data-lucide="${name.replace(/([a-z0-9])([A-Z])/g,'$1-$2').toLowerCase()}" class="${cls}" aria-hidden="true"></i>`;
const initIcons=()=>createIcons({icons,attrs:{'stroke-width':1.7}});
const date=value=>value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'아직 실행하지 않았어요';
const unknown=value=>value==null || value===''?'- (알 수 없음)':escape(value);
const label={queued:'대기 중',running:'수집 중',succeeded:'완료',partial:'부분 성공',failed:'실패',manual:'수동',scheduled:'자동',migration:'이전'};
const badge=(status)=>`<span class="badge ${escape(status)}">${escape(label[status]||status)}</span>`;
function toast(text,error=false){const el=$('#toast');el.textContent=text;el.className='visible'+(error?' error':'');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.className='',5000);}
async function api(path,options={},retry=true){
  const response=await fetch('/api'+path,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  if(response.status===401 && retry && !path.startsWith('/auth/')){
    const refresh=await fetch('/api/auth/refresh',{method:'POST'});
    if(refresh.ok)return api(path,options,false);
    state.user=null;render();throw new Error('로그인이 필요합니다.');
  }
  const data=await response.json();
  if(!response.ok)throw new Error(data.error || '요청을 처리하지 못했습니다.');
  return data;
}
const post=(path,data={},method='POST')=>api(path,{method,body:JSON.stringify(data)});
function navigate(path){history.pushState({},'',path);state.page='dashboard';render();if(path!=='/')loadData();}
window.addEventListener('popstate',()=>{state.page='dashboard';render();});

function home(){
  const last=state.competitors.flatMap(c=>c.apps).map(a=>a.last_success_at).filter(Boolean).sort().at(-1);
  return `<div class="portal">
    <header class="portal-nav"><a class="brand" href="/" data-home><span class="brand-mark">${icon('Zap')}</span>automation<span class="brand-light">hub</span></a>
    <div class="nav-right"><span class="personal-label">YOUR WORKSPACE</span><button class="avatar" data-login aria-label="관리자 로그인">${state.user?'MY':icon('ShieldCheck')}</button></div></header>
    <main class="portal-main"><div class="eyebrow"><span></span> SMALL TOOLS. MORE POSSIBILITIES.</div>
    <h1>반복되는 일은 간편하게,<br><span>당신의 시간은 더 가치 있게.</span></h1>
    <p class="portal-intro">매일의 업무를 가볍게 만드는 도구를 만나보세요.</p>
    <div class="carousel-heading"><span>나의 자동화 도구 <b>02</b></span><div class="carousel-controls"><button class="icon-button" data-slide="-1" aria-label="이전 도구">${icon('ChevronLeft')}</button><button class="icon-button" data-slide="1" aria-label="다음 도구">${icon('ChevronRight')}</button></div></div>
    <section class="card-track" aria-label="자동화 프로젝트" aria-roledescription="캐러셀" tabindex="0">
      <article class="tool-card active-card" aria-label="1 / 2 경쟁사 앱 업데이트 조사 자동화">
        <div class="card-color"><span class="card-category">MARKET INTELLIGENCE</span><span class="card-number">01</span></div>
        <div class="tool-emblem">${icon('ChartNoAxesCombined')}</div>
        <div class="card-body"><span class="availability"><span></span> 사용 가능</span><h2>경쟁사 앱 업데이트<br>조사 자동화</h2><p>앱의 변화를 놓치지 않도록.<br>업데이트부터 과거 기록까지 한곳에서.</p>
        <div class="last-run">${icon('Clock3')}<span>최근 실행 <b>${last?escape(date(last)):'실행 기록 없음'}</b></span></div>
        <button class="launch-button" data-launch>실행하기 ${icon('ArrowRight')}</button></div>
      </article>
      <article class="tool-card upcoming-card" aria-label="2 / 2 Aircrew Monitoring 준비 중">
        <div class="card-color muted"><span class="card-category">OPERATIONS</span><span class="card-number">02</span></div>
        <div class="tool-emblem muted">${icon('Plane')}</div>
        <div class="card-body"><span class="availability upcoming">COMING SOON</span><h2>Aircrew<br>Monitoring</h2><p>또 하나의 반복 업무도 더 간편하게.<br>새로운 자동화 도구를 준비하고 있어요.</p>
        <div class="last-run">${icon('Clock3')}<span>곧 만나보실 수 있어요</span></div>
        <button class="launch-button" disabled>준비 중 ${icon('Clock3')}</button></div>
      </article>
    </section>
    <div class="carousel-bottom"><div class="dots"><button class="${state.selectedCard===0?'selected':''}" data-select-card="0" aria-label="첫 번째 카드" aria-pressed="${state.selectedCard===0}"></button><button class="${state.selectedCard===1?'selected':''}" data-select-card="1" aria-label="두 번째 카드" aria-pressed="${state.selectedCard===1}"></button></div><span>필요한 도구는 계속 더해집니다.</span></div>
    </main><footer class="portal-footer"><span>LESS REPETITION, MORE FOCUS.</span><span>Automation Hub · 나만의 업무 공간</span></footer></div>`;
}
function shell(){
  const pageTitle={dashboard:'업데이트 대시보드',manage:'경쟁사 관리',history:'수집 이력'}[state.page];
  return `<div class="workspace">
    <aside class="sidebar"><a class="brand" href="/" data-home><span class="brand-mark">${icon('Zap')}</span>automation<span class="brand-light">hub</span></a>
    <a href="/" data-home class="back-link">${icon('ArrowLeft')} 모든 도구</a><div class="nav-section-label">COMPETITOR ANALYZER</div>
    <nav>${[['dashboard','LayoutGrid','대시보드'],['manage','Layers','경쟁사 관리'],['history','Clock3','수집 이력']].map(([p,i,n])=>`<button data-page="${p}" class="nav-item ${state.page===p?'selected':''}">${icon(i)}${n}${p==='manage'?`<span>${state.competitors.filter(c=>!c.archived_at).length}</span>`:''}</button>`).join('')}</nav>
    <div class="sidebar-bottom"><div class="preservation-note">${icon('Database')}<strong>기록은 계속 남습니다</strong><p>스토어에서 사라진 업데이트도<br>수집한 기록은 안전하게 보존합니다.</p></div>
    <button class="nav-item" data-help>${icon('CircleHelp')} 사용 안내</button><button class="nav-item" data-login>${icon(state.user?'LogOut':'ShieldCheck')}${state.user?'로그아웃':'관리자 로그인'}</button></div></aside>
    <div class="workspace-body"><header class="topbar"><button class="icon-button mobile-menu" data-menu aria-label="메뉴 열기">${icon('Menu')}</button><div class="breadcrumbs">Workspace <span>/</span> <strong>Competitor Analyzer</strong></div><div class="account"><span class="secure-dot"></span>${state.user?'관리자 워크스페이스':'워크스페이스'}<button class="avatar" data-login aria-label="계정">${icon('ShieldCheck')}</button></div></header>
    <main class="content"><div class="page-heading"><div><div class="eyebrow">COMPETITOR INTELLIGENCE</div><h1>${pageTitle}</h1><p>경쟁사의 새로운 움직임, 놓치지 않고 기록하세요.</p></div><div class="heading-actions"><button class="button secondary" data-export>${icon('Download')} 내보내기</button><button class="button primary" data-add>${icon('Plus')} 경쟁사 등록</button></div></div>
    ${!state.config?.database || !state.config?.authentication || !state.config?.origin?`<div class="notice">${icon('Settings2')}<div><strong>서비스 연결을 준비하고 있습니다</strong><p>Supabase와 관리자 인증 설정 후 실제 수집·저장을 사용할 수 있습니다. 아직 저장된 데이터는 없습니다.</p></div><button class="text-button" data-setup>설정 안내 ${icon('ArrowRight')}</button></div>`:
      !state.user?`<div class="notice">${icon('ShieldCheck')}<div><strong>관리자 로그인이 필요합니다</strong><p>로그인 후 경쟁사 등록, 수집 및 저장된 이력을 이용할 수 있습니다.</p></div><button class="button primary" data-login>로그인</button></div>`:''}
    ${state.page==='history'?runsView():dashboardView()}
    <footer class="content-footer"><span>수집한 과거 기록은 최신 데이터로 덮어쓰지 않습니다.</span><span>모든 시간은 한국 표준시(KST) 기준</span></footer></main></div></div>`;
}
function dashboardView(){
  const active=state.competitors.filter(c=>!c.archived_at);
  const apps=active.flatMap(c=>c.apps);
  const changed=apps.filter(a=>Number(a.change_count)>0).length;
  const pending=apps.filter(a=>a.job_status).length;
  const failed=apps.filter(a=>a.last_error_message).length;
  return `<div class="stats-grid">${[['모니터링 경쟁사',active.length,'Layers','등록된 경쟁사 기준'],['변경 감지 앱',changed,'ChartNoAxesCombined','직전 수집과 비교'],['대기 · 수집 중',pending,'RefreshCw','작업 상태 자동 갱신'],['확인이 필요한 앱',failed,'AlertCircle','최근 수집 오류']].map(([title,n,i,sub])=>`<div class="stat-card"><span class="stat-icon">${icon(i)}</span><span class="stat-title">${title}</span><strong>${n}<small>개</small></strong><span class="stat-sub">${sub}</span></div>`).join('')}</div>
    <section class="data-panel"><div class="panel-heading"><div class="platform-tabs" role="tablist" aria-label="스토어 선택"><button role="tab" aria-selected="${state.platform==='app_store'}" class="${state.platform==='app_store'?'selected':''}" data-platform="app_store">App Store <span>${apps.filter(a=>a.platform==='app_store').length}</span></button><button role="tab" aria-selected="${state.platform==='play_store'}" class="${state.platform==='play_store'?'selected':''}" data-platform="play_store">Play Store <span>${apps.filter(a=>a.platform==='play_store').length}</span></button></div><button class="button secondary small" data-collect-all>${icon('RefreshCw')} 전체 수집</button></div>
    <div class="table-toolbar"><label class="search-field">${icon('Search')}<input type="search" id="search" placeholder="경쟁사 또는 앱 이름 검색" value="${escape(state.search)}" aria-label="경쟁사 검색"></label><div class="filters"><select id="scope" aria-label="서비스 구분">${[['all','모든 지역'],['domestic','국내'],['global','국외'],['unknown','미분류']].map(([v,l])=>`<option value="${v}" ${state.scope===v?'selected':''}>${l}</option>`).join('')}</select><select id="status" aria-label="수집 상태">${[['all','모든 상태'],['changed','변경 있음'],['error','수집 오류'],['pending','대기 · 실행 중']].map(([v,l])=>`<option value="${v}" ${state.status===v?'selected':''}>${l}</option>`).join('')}</select>${state.page==='manage'?`<label class="checkbox-label"><input type="checkbox" id="archived" ${state.archived?'checked':''}> 보관 포함</label>`:''}</div></div>
    <div id="table-content">${tableContent()}</div><div class="table-footer"><span>전체 ${active.length}개 경쟁사</span><span>${icon('ShieldCheck')} 과거 업데이트 이력 보존</span></div></section>`;
}
function filtered(){
  return state.competitors.filter(c=>{
    const a=c.apps.find(a=>a.platform===state.platform);
    return (!c.archived_at || state.archived) && (state.scope==='all'||c.service_scope===state.scope)
      && `${c.name} ${a?.snapshot?.app_name||''}`.toLowerCase().includes(state.search.toLowerCase())
      && (state.status==='all'||(state.status==='changed'&&Number(a?.change_count)>0)||(state.status==='error'&&a?.last_error_message)||(state.status==='pending'&&a?.job_status));
  });
}
function tableContent(){
  const list=filtered();
  if(!list.length)return `<div class="empty-state"><div class="empty-icon">${icon(state.search?'Search':'ChartNoAxesCombined')}</div><h2>${state.competitors.length?'조건에 맞는 경쟁사가 없어요':'첫 번째 경쟁사를 등록해 보세요'}</h2><p>${state.competitors.length?'검색어나 필터를 변경해 다시 확인해 주세요.':'App Store 또는 Play Store 링크만 있으면 시작할 수 있어요.<br>업데이트와 변경 이력을 한곳에서 확인하세요.'}</p>${state.competitors.length?'':`<button class="button primary" data-add>${icon('Plus')} 경쟁사 등록하기</button>`}</div>`;
  return `<div class="table-scroll"><table><thead><tr>${state.page==='manage'?'<th>순서</th>':''}<th>경쟁사 / 앱 이름</th><th>구분</th><th>${state.platform==='app_store'?'최신 버전':'업데이트 날짜'}</th><th>평점</th><th>변경 상태</th><th>최근 수집</th><th class="align-right">관리</th></tr></thead><tbody>${list.map(c=>{
    const a=c.apps.find(a=>a.platform===state.platform),s=a?.snapshot;
    return `<tr data-row="${c.id}" ${state.page==='manage'&&!c.archived_at?'draggable="true"':''}><td ${state.page==='manage'?'':'hidden'}><div class="order-actions">${icon('GripVertical')}<button class="icon-button" data-move="${c.id}" data-direction="-1" aria-label="${escape(c.name)} 위로">${icon('ChevronUp')}</button><button class="icon-button" data-move="${c.id}" data-direction="1" aria-label="${escape(c.name)} 아래로">${icon('ChevronDown')}</button></div></td><td><div class="app-cell"><span class="app-symbol">${icon('Layers')}</span><div><button class="name-button" ${a?`data-detail="${a.id}"`:''}>${escape(c.name)}</button>${c.archived_at?'<span class="badge">보관됨</span>':''}<small>${escape(s?.app_name || (a?'첫 수집 대기':'스토어 미등록'))}</small></div></div></td><td><span class="scope-chip">${{domestic:'국내',global:'국외',unknown:'미분류'}[c.service_scope]}</span></td><td>${a?unknown(state.platform==='app_store'?s?.version:s?.source_updated_at?.slice(0,10)):'—'}</td><td>${s?.rating!=null?Number(s.rating).toFixed(2):'—'}</td><td>${a?.job_status?badge(a.job_status):a?.last_error_message?badge('failed'):Number(a?.change_count)>0?'<span class="badge changed">변경 있음</span>':s?badge(s.normalized_payload?.quality==='partial'?'partial':'succeeded'):'<span class="badge">수집 전</span>'}</td><td class="date-cell">${a?.last_success_at?escape(date(a.last_success_at)):'—'}${Number(a?.missing_count)>0?`<small>과거 릴리즈 ${a.missing_count}개 보존</small>`:''}</td><td><div class="row-actions">${a?`<button class="icon-button" data-detail="${a.id}" aria-label="${escape(c.name)} 이력 보기">${icon('Clock3')}</button>`:''}${!c.archived_at?`<button class="icon-button" data-collect="${c.id}" aria-label="${escape(c.name)} 수집">${icon('RefreshCw')}</button><button class="icon-button" data-edit="${c.id}" aria-label="${escape(c.name)} 수정">${icon('Pencil')}</button><button class="icon-button danger" data-archive="${c.id}" aria-label="${escape(c.name)} 보관">${icon('Archive')}</button>`:''}</div></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function runsView(){
  return `<section class="data-panel"><div class="panel-heading"><h2>수집 실행 기록</h2><button class="button secondary small" data-reload>${icon('RefreshCw')} 새로고침</button></div>${state.runs.length?`<div class="run-list">${state.runs.map(r=>`<details class="run-row"><summary><span class="run-icon">${icon('RefreshCw')}</span><div><strong>${label[r.trigger_type]} 수집</strong><small>${date(r.created_at)}</small></div>${badge(r.status)}<span class="run-count">성공 ${r.success_count} / 실패 ${r.failure_count} / 전체 ${r.total_count}</span>${icon('ChevronDown')}</summary><div class="run-details">${r.items.length?r.items.map(i=>`<div><strong>${escape(i.name)} · ${i.platform==='app_store'?'App Store':'Play Store'}</strong>${badge(i.status)}<p>${escape(i.error || '오류 없음')}</p></div>`).join(''):'JSON 데이터 이전 작업입니다.'}</div></details>`).join('')}</div>`:`<div class="empty-state"><div class="empty-icon">${icon('Clock3')}</div><h2>아직 수집 기록이 없어요</h2><p>경쟁사를 등록하고 수집하면 실행 상태와 결과가 여기에 표시됩니다.</p></div>`}<div class="table-footer"><button class="text-button" data-runs-prev ${state.runOffset===0?'disabled':''}>이전 50건</button><span>${state.runOffset+1}부터 최대 50건</span><button class="text-button" data-runs-next ${state.runs.length<50?'disabled':''}>다음 50건</button></div></section>`;
}
function render(){
  $('#app').innerHTML=location.pathname==='/'?home():shell();initIcons();bind();
  document.title=location.pathname==='/'?'Automation Hub · 업무 자동화':'경쟁사 앱 업데이트 · Automation Hub';
}
function bind(){
  document.querySelectorAll('[data-home]').forEach(e=>e.onclick=event=>{event.preventDefault();navigate('/');});
  document.querySelectorAll('[data-launch]').forEach(e=>e.onclick=()=>navigate('/competitor-analyzer'));
  document.querySelectorAll('[data-login]').forEach(e=>e.onclick=account);
  document.querySelectorAll('[data-add]').forEach(e=>e.onclick=()=>competitorForm());
  document.querySelectorAll('[data-edit]').forEach(e=>e.onclick=()=>competitorForm(state.competitors.find(c=>c.id===e.dataset.edit)));
  document.querySelectorAll('[data-archive]').forEach(e=>e.onclick=()=>archive(e.dataset.archive));
  document.querySelectorAll('[data-collect]').forEach(e=>e.onclick=()=>collect(e.dataset.collect));
  document.querySelectorAll('[data-collect-all]').forEach(e=>e.onclick=()=>collect());
  document.querySelectorAll('[data-detail]').forEach(e=>e.onclick=()=>detail(e.dataset.detail));
  document.querySelectorAll('[data-export]').forEach(e=>e.onclick=exportForm);
  document.querySelectorAll('[data-page]').forEach(e=>e.onclick=()=>{state.page=e.dataset.page;state.archived=false;state.runOffset=0;render();loadData();});
  document.querySelectorAll('[data-platform]').forEach(e=>e.onclick=()=>{state.platform=e.dataset.platform;render();});
  document.querySelectorAll('[data-slide]').forEach(e=>e.onclick=()=>slide(Number(e.dataset.slide)));
  document.querySelectorAll('[data-select-card]').forEach(e=>e.onclick=()=>slide(Number(e.dataset.selectCard)-state.selectedCard));
  $('.card-track')?.addEventListener('keydown',e=>{if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(e.key)){e.preventDefault();slide(['ArrowRight','ArrowDown'].includes(e.key)?1:-1);}});
  $('.card-track')?.addEventListener('wheel',e=>{if(Math.abs(e.deltaY)>Math.abs(e.deltaX)&&Math.abs(e.deltaY)>15){e.preventDefault();if(!slide.lock){slide(Math.sign(e.deltaY));slide.lock=true;setTimeout(()=>slide.lock=false,500);}}},{passive:false});
  $('.card-track')?.addEventListener('scroll',event=>{const track=event.currentTarget;if(!track.isConnected)return;const cards=[...track.children];state.selectedCard=cards.reduce((best,c,i)=>Math.abs(c.offsetLeft-cards[0].offsetLeft-track.scrollLeft)<Math.abs(cards[best].offsetLeft-cards[0].offsetLeft-track.scrollLeft)?i:best,0);document.querySelectorAll('[data-select-card]').forEach((e,i)=>{e.classList.toggle('selected',i===state.selectedCard);e.setAttribute('aria-pressed',String(i===state.selectedCard));});});
  $('#search')?.addEventListener('input',e=>{state.search=e.target.value;$('#table-content').innerHTML=tableContent();initIcons();bindTable();});
  $('#scope')?.addEventListener('change',e=>{state.scope=e.target.value;render();});
  $('#status')?.addEventListener('change',e=>{state.status=e.target.value;render();});
  $('#archived')?.addEventListener('change',e=>{state.archived=e.target.checked;loadData();});
  $('[data-menu]')?.addEventListener('click',()=>$('.sidebar').classList.toggle('open'));
  $('[data-setup]')?.addEventListener('click',setupHelp);
  $('[data-help]')?.addEventListener('click',help);
  $('[data-reload]')?.addEventListener('click',()=>loadData(true));
  $('[data-runs-prev]')?.addEventListener('click',()=>{state.runOffset=Math.max(0,state.runOffset-50);loadData();});
  $('[data-runs-next]')?.addEventListener('click',()=>{state.runOffset+=50;loadData();});
  bindTable();
}
function bindTable(){
  document.querySelectorAll('#table-content [data-add]').forEach(e=>e.onclick=()=>competitorForm());
  document.querySelectorAll('#table-content [data-detail]').forEach(e=>e.onclick=()=>detail(e.dataset.detail));
  document.querySelectorAll('#table-content [data-edit]').forEach(e=>e.onclick=()=>competitorForm(state.competitors.find(c=>c.id===e.dataset.edit)));
  document.querySelectorAll('#table-content [data-collect]').forEach(e=>e.onclick=()=>collect(e.dataset.collect));
  document.querySelectorAll('#table-content [data-archive]').forEach(e=>e.onclick=()=>archive(e.dataset.archive));
  document.querySelectorAll('[data-move]').forEach(e=>e.onclick=()=>move(e.dataset.move,Number(e.dataset.direction)));
  document.querySelectorAll('tr[draggable]').forEach(e=>{
    e.ondragstart=event=>{event.dataTransfer.setData('text/plain',e.dataset.row);};
    e.ondragover=event=>event.preventDefault();
    e.ondrop=event=>{event.preventDefault();const id=event.dataTransfer.getData('text/plain');const ids=state.competitors.filter(c=>!c.archived_at).map(c=>c.id);const from=ids.indexOf(id),to=ids.indexOf(e.dataset.row);if(from>=0&&to>=0){ids.splice(from,1);ids.splice(to,0,id);saveOrder(ids);}};
  });
}
function slide(delta){
  state.selectedCard=(state.selectedCard+delta+2)%2;
  const track=$('.card-track'),card=track.children[state.selectedCard];
  track.scrollTo({left:card.offsetLeft-track.children[0].offsetLeft,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  document.querySelectorAll('[data-select-card]').forEach((e,i)=>{e.classList.toggle('selected',i===state.selectedCard);e.setAttribute('aria-pressed',String(i===state.selectedCard));});
}
async function loadData(show=false){
  if(!state.user)return;
  try{
    const [data,runs]=await Promise.all([api('/competitors?archived='+state.archived),api('/collections?offset='+state.runOffset)]);
    state.competitors=data.competitors;state.runs=runs.runs;render();if(show)toast('최신 상태를 불러왔습니다.');
  }catch(error){toast(error.message,true);}
}
function modal(title,content,wide=false){
  const d=$('#modal');d.className=wide?'wide':'';
  d.innerHTML=`<div class="modal-heading"><div><span class="eyebrow">AUTOMATION HUB</span><h2 id="modal-title">${escape(title)}</h2></div><button class="icon-button" data-close aria-label="닫기">${icon('X')}</button></div>${content}`;
  d.setAttribute('aria-labelledby','modal-title');if(!d.open)d.showModal();d.querySelector('[data-close]').onclick=()=>d.close();initIcons();
}
function setupHelp(){
  modal('서비스 연결 안내',`<div class="help-content"><p>실제 수집과 저장을 위해 아래 서버 설정이 필요합니다.</p><ol><li>Supabase 프로젝트와 관리자 계정을 생성합니다.</li><li>데이터베이스 마이그레이션을 실행합니다.</li><li>Supabase URL·키, DB 연결, 관리자 이메일을 환경 변수에 등록합니다.</li><li>Vercel 배포 주소를 APP_ORIGIN으로 설정합니다.</li><li>별도 수집 Worker를 실행합니다.</li></ol><p class="muted-text">구체적인 명령은 저장소의 README.md에 있습니다. 비밀번호나 서버 키를 이 화면에 입력하지 마세요.</p></div>`);
}
function help(){modal('기록을 모으는 가장 간단한 방법',`<div class="help-content"><ol><li><strong>경쟁사 등록</strong><p>경쟁사명과 공식 스토어 링크를 입력합니다.</p></li><li><strong>수집과 비교</strong><p>수동 수집 또는 하루 한 번 자동 수집으로 변화를 확인합니다.</p></li><li><strong>이력 확인</strong><p>앱 이름을 선택하면 릴리즈, 설명 개정본과 시점별 수치를 조회할 수 있습니다.</p></li></ol><p>‘부분 성공’은 일부 필드나 버전 기록을 확인하지 못한 상태입니다. 이전 정상 기록은 계속 보존됩니다.</p><p>‘스토어 응답에서 미확인’은 실제 삭제일이 아니라 수집 시점의 관측 결과입니다.</p></div>`);}
async function account(){
  if(state.user){await post('/auth/logout');state.user=null;state.competitors=[];state.runs=[];render();toast('로그아웃했습니다.');return;}
  if(!state.config?.authentication || !state.config?.database || !state.config?.origin)return setupHelp();
  modal('관리자 로그인',`<form id="login-form" class="form"><p class="muted-text">등록된 관리자 계정으로 로그인해 주세요.</p><label>이메일<input name="email" type="email" required autocomplete="username" placeholder="you@example.com"></label><label>비밀번호<input name="password" type="password" required autocomplete="current-password"></label><p class="form-error" role="alert"></p><button class="button primary full">로그인 ${icon('ArrowRight')}</button></form>`);
  $('#login-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const result=await post('/auth/login',Object.fromEntries(new FormData(e.target)));state.user=result.user;$('#modal').close();await loadData();toast('로그인했습니다.');}catch(error){e.target.querySelector('.form-error').textContent=error.message;}finally{button.disabled=false;}};
}
function needsLogin(){if(!state.user){account();return true;}return false;}
function competitorForm(c){
  if(needsLogin())return;
  const link=p=>c?.apps.find(a=>a.platform===p)?.store_url || '';
  modal(c?'경쟁사 수정':'새 경쟁사 등록',`<form id="competitor-form" class="form"><label>경쟁사명 <span class="required">*</span><input name="name" maxlength="120" required placeholder="예: 모니터링할 서비스 이름" value="${escape(c?.name||'')}"></label><label>서비스 구분<select name="service_scope"><option value="domestic" ${c?.service_scope==='domestic'?'selected':''}>국내</option><option value="global" ${c?.service_scope==='global'?'selected':''}>국외</option><option value="unknown" ${c?.service_scope==='unknown'?'selected':''}>미분류</option></select></label><label>App Store 링크<input name="app_store" type="url" placeholder="https://apps.apple.com/kr/app/…/id…" value="${escape(link('app_store'))}"></label><label>Play Store 링크<input name="play_store" type="url" placeholder="https://play.google.com/store/apps/details?id=…" value="${escape(link('play_store'))}"></label><p class="field-note">둘 중 하나 이상의 스토어 링크를 입력해 주세요.</p><label class="checkbox-label"><input name="auto_collect" type="checkbox" ${c?.auto_collect!==false?'checked':''}> 하루 한 번 자동 수집</label><p class="form-error" role="alert"></p><button class="button primary full">${c?'변경 사항 저장':'등록하고 첫 수집 시작'}</button></form>`);
  $('#competitor-form').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));data.auto_collect=e.target.elements.auto_collect.checked;const button=e.target.querySelector('button');button.disabled=true;try{await post(c?'/competitors/'+c.id:'/competitors',data,c?'PATCH':'POST');$('#modal').close();await loadData();toast(c?'경쟁사 정보를 저장했습니다.':'등록했습니다. Worker가 수집 작업을 처리합니다.');}catch(error){e.target.querySelector('.form-error').textContent=error.message;}finally{button.disabled=false;}};
}
async function collect(id){
  if(needsLogin()||state.busy)return;
  state.busy=true;try{await post(id?`/competitors/${id}/collect`:'/collections');toast('수집을 요청했습니다. 진행 상태는 자동으로 갱신됩니다.');await loadData();}catch(error){toast(error.message,true);}finally{state.busy=false;}
}
function archive(id){
  const c=state.competitors.find(c=>c.id===id);
  modal('경쟁사 보관',`<div class="help-content"><p><strong>${escape(c.name)}</strong>을 활성 목록에서 보관할까요?</p><p>자동 수집은 중단되며 기존 스냅샷과 릴리즈 이력은 삭제되지 않습니다.</p><button class="button danger-button full" id="archive-confirm">보관하기</button></div>`);
  $('#archive-confirm').onclick=async()=>{try{await post('/competitors/'+id,{},'DELETE');$('#modal').close();loadData();toast('보관했습니다. 경쟁사 관리에서 보관 포함으로 조회할 수 있습니다.');}catch(error){toast(error.message,true);}};
}
function move(id,direction){const ids=state.competitors.filter(c=>!c.archived_at).map(c=>c.id);const index=ids.indexOf(id),next=index+direction;if(next<0||next>=ids.length)return;[ids[index],ids[next]]=[ids[next],ids[index]];saveOrder(ids);}
async function saveOrder(ids){try{await post('/competitors/reorder',{ids});await loadData();toast('표시 순서를 저장했습니다.');}catch(error){toast(error.message,true);}}
async function detail(id,query='',offset=0){
  if(needsLogin())return;
  try{
    const data=await api(`/store-apps/${id}/history?${query}${query?'&':''}offset=${offset}`);
    const c=await api('/competitors/'+data.app.competitor_id);
    const params=new URLSearchParams(query);
    modal(c?.name || '앱 이력',`<div class="detail-body"><div class="detail-platform"><span class="scope-chip">${data.app.platform==='app_store'?'App Store':'Play Store'}</span><a href="${escape(data.app.store_url)}" target="_blank" rel="noopener noreferrer">스토어 열기 ${icon('ExternalLink')}</a></div>
    ${c.apps.length>1?`<label class="connection-picker">수집 대상 · 이전 연결 포함<select id="history-connection">${c.apps.map(a=>`<option value="${a.id}" ${a.id===id?'selected':''}>${a.platform==='app_store'?'App Store':'Play Store'} · ${escape(a.external_id)} · ${escape(a.country)}${a.is_active?'':' (이전 연결)'}</option>`).join('')}</select></label>`:''}
    ${data.app.last_error_message?`<div class="notice compact"><p>${escape(data.app.last_error_message)}</p></div>`:''}
    <form id="history-filter" class="date-filter"><label>시작일<input type="date" name="from" value="${escape(params.get('from')||'')}"></label><label>종료일<input type="date" name="to" value="${escape(params.get('to')||'')}"></label><button class="button secondary small">기간 조회</button></form>
    <div class="detail-tabs"><button data-detail-tab="releases" class="selected">릴리즈 이력</button><button data-detail-tab="snapshots">시점별 수치</button><button data-detail-tab="changes">변경 이벤트</button></div>
    <div id="detail-releases">${data.releases.length?data.releases.map(r=>`<article class="release-entry"><div class="release-top"><strong>${r.version?'v'+escape(r.version):'버전 알 수 없음'}</strong><span class="badge ${r.is_present_in_source?'succeeded':''}">${r.is_present_in_source?'최근 관측된 기록':'스토어 응답에서 미확인'}</span></div><div class="release-meta">공개일 ${unknown(r.release_date)} · 최초 관측 ${date(r.first_seen_at)}<br>마지막 관측 ${date(r.last_seen_at)}${r.missing_since?' · 미확인 시작 '+date(r.missing_since):''}</div>${r.revisions.map((n,i)=>`<details ${i===0?'open':''}><summary>업데이트 설명 ${r.revisions.length>1?`· 개정본 ${r.revisions.length-i}`:''} <span>${date(n.last_seen_at)}</span></summary><p class="release-notes">${escape(n.notes || '제공된 설명 없음')}</p></details>`).join('')}</article>`).join(''):'<p class="detail-empty">해당 기간에 관측된 릴리즈가 없습니다.</p>'}</div>
    <div id="detail-snapshots" hidden><div class="table-scroll"><table><thead><tr><th>수집 시각</th><th>평점</th><th>평가 수</th><th>리뷰 수</th><th>다운로드 구간</th></tr></thead><tbody>${data.snapshots.map(s=>`<tr><td>${date(s.collected_at)}</td><td>${unknown(s.rating)}</td><td>${unknown(s.rating_count)}</td><td>${unknown(s.review_count)}</td><td>${unknown(s.downloads_text)}</td></tr>`).join('')}</tbody></table>${!data.snapshots.length?'<p class="detail-empty">수집된 스냅샷이 없습니다.</p>':''}</div></div>
    <div id="detail-changes" hidden>${data.changes.map(e=>`<article class="release-entry"><strong>${escape(e.field)}</strong><span class="release-meta"> · ${date(e.occurred_at)}</span><p class="release-notes"><del>${escape(e.old_value??'알 수 없음')}</del><br>${escape(e.new_value??'알 수 없음')}</p></article>`).join('')||'<p class="detail-empty">해당 기간의 변경 이벤트가 없습니다.</p>'}</div>
    <div class="detail-pagination"><button class="text-button" id="history-prev" ${offset===0?'disabled':''}>이전</button><span>${offset+1}부터 항목별 최대 200건</span><button class="text-button" id="history-next" ${Math.max(data.releases.length,data.snapshots.length,data.changes.length)<200?'disabled':''}>다음</button></div></div>`,true);
    $('#history-filter').onsubmit=e=>{e.preventDefault();const q=new URLSearchParams();for(const [k,v]of new FormData(e.target))if(v)q.set(k,v);detail(id,q.toString());};
    $('#history-connection')?.addEventListener('change',e=>detail(e.target.value,query));
    document.querySelectorAll('[data-detail-tab]').forEach(e=>e.onclick=()=>{document.querySelectorAll('[data-detail-tab]').forEach(b=>b.classList.toggle('selected',b===e));for(const t of ['releases','snapshots','changes'])$('#detail-'+t).hidden=t!==e.dataset.detailTab;});
    $('#history-prev').onclick=()=>detail(id,query,Math.max(0,offset-200));$('#history-next').onclick=()=>detail(id,query,offset+200);
  }catch(error){toast(error.message,true);}
}
function exportForm(){
  if(needsLogin())return;
  modal('데이터 내보내기',`<form id="export-form" class="form"><label>조회 범위<select name="mode"><option value="latest">최신 현황</option><option value="releases">전체 릴리즈 이력</option><option value="snapshots">기간별 스냅샷</option><option value="changes">변경 이벤트</option></select></label><div class="date-filter"><label>시작일<input name="from" type="date"></label><label>종료일<input name="to" type="date"></label></div><p class="field-note">최신 현황에는 기간이 적용되지 않습니다. 날짜를 비우면 전체 기간을 조회합니다.</p><label>파일 형식<select name="format"><option value="xlsx">Excel (.xlsx)</option><option value="html">HTML 보고서</option><option value="csv">CSV</option><option value="json">JSON</option><option value="markdown">Markdown</option></select></label><p class="form-error" role="alert"></p><button class="button primary full">${icon('Download')} 다운로드</button></form>`);
  $('#export-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const params=new URLSearchParams();for(const[k,v]of new FormData(e.target))if(v)params.set(k,v);const response=await fetch('/api/export?'+params);if(!response.ok)throw new Error((await response.json()).error);const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]||'export';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('#modal').close();toast('내보내기 파일을 생성했습니다.');}catch(error){e.target.querySelector('.form-error').textContent=error.message;}finally{button.disabled=false;}};
}
render();
async function initialize(){
try {
  state.config=await api('/config');
  if(state.config.authentication) {
    try{state.user=(await api('/auth/me',{},false)).user;}
    catch{try{await post('/auth/refresh');state.user=(await api('/auth/me',{},false)).user;}catch{/* Login required. */}}
  }
  if(state.user)await loadData();else render();
}catch{toast('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',true);}
}
initialize();
setInterval(()=>{if(state.user && !document.hidden && !$('#modal').open && !$('#search')?.matches(':focus') && location.pathname!=='/' && state.competitors.some(c=>c.apps.some(a=>a.job_status)))loadData();},5000);
