const labels={JP:'일본',VN:'베트남',CN:'중국',TW:'대만',HK:'홍콩',MO:'마카오',TH:'태국',US:'미국'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function mountPersonal(root,{api,context,apply}){
 let items=[],editing=null;
 const request=(path,data,method='POST')=>api(path,{method,...(data?{body:JSON.stringify(data)}:{})});
 async function load(){try{items=(await api('/aviation/personal')).items;if(root.isConnected)draw();}catch(e){if(root.isConnected)root.textContent=e.message;}}
 function draw(){
 editing=null;
 const preference=items.find(i=>i.kind==='preferences');
 root.innerHTML=`<h2>나의 관찰 기록</h2><p>이 영역은 관리자 본인에게만 보입니다. 관심 국가는 개인 설정이며 현재 원천 응답 목록을 국가별로 필터링하지 않습니다.</p><form id="aviation-preferences"><fieldset><legend>관심 국가</legend>${Object.entries(labels).map(([code,name])=>`<label style="display:inline-flex;gap:6px;margin:8px"><input type="checkbox" name="country" value="${code}" ${(context().countries??preference?.payload.countries??Object.keys(labels)).includes(code)?'checked':''}>${name}</label>`).join('')}</fieldset><button class="button secondary">관심 국가 저장</button></form><form id="aviation-record" class="form"><label>종류<select name="kind"><option value="filter">조회 조건</option><option value="note">관찰 메모</option></select></label><label>이름<input name="title" maxlength="80" required></label><label>메모<textarea name="text" maxlength="5000" rows="4"></textarea></label><p>저장할 때 현재 화면·기준월·선택한 관심 국가를 함께 기록합니다. 메모는 개인 관찰이며 검증된 통계로 취급하지 않습니다.</p><button class="button primary">새 기록 저장</button><button type="button" class="button secondary" id="aviation-cancel" hidden>수정 취소</button></form><p role="status" id="personal-result"></p><div>${items.filter(i=>i.kind!=='preferences').map(i=>`<article class="release-card"><strong>${esc(i.title)}</strong><p>${i.kind==='note'?'메모':'조회 조건'} · ${i.payload.tab==='recent'?'최근 변화':'시장·계절 패턴'} · ${esc(i.payload.month||'전체 확보월')} · ${i.payload.countries.map(c=>esc(labels[c])).join(', ')||'관심 국가 없음'}</p>${i.kind==='note'?`<p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(i.payload.text)}</p>`:''}<button class="button secondary" data-apply="${i.id}">조건 불러오기</button><button class="button secondary" data-edit-personal="${i.id}">수정</button><button class="button secondary" data-delete-personal="${i.id}">삭제</button></article>`).join('')||'<p>저장된 기록이 없습니다.</p>'}</div>`;
 const selected=()=>[...root.querySelectorAll('[name=country]:checked')].map(e=>e.value);
 const run=async(button,fn)=>{button.disabled=true;try{await fn();await load();}catch(e){root.querySelector('#personal-result').textContent=e.message;}finally{button.disabled=false;}};
 root.querySelector('#aviation-preferences').onsubmit=e=>{e.preventDefault();void run(e.submitter,()=>request('/aviation/personal',{kind:'preferences',title:'관심 국가',payload:{...context(),countries:selected()}}));};
 const form=root.querySelector('#aviation-record');
 const reset=()=>{editing=null;form.reset();form.elements.kind.disabled=false;form.querySelector('[type=button]').hidden=true;form.querySelector('.primary').textContent='새 기록 저장';};
 form.onsubmit=e=>{e.preventDefault();const old=items.find(i=>i.id===editing);const kind=form.elements.kind.value;const payload=old?{...old.payload,text:form.elements.text.value}:{...context(),countries:selected(),text:form.elements.text.value};void run(e.submitter,async()=>{await request('/aviation/personal'+(editing?'/'+editing:''),{kind,title:form.elements.title.value,payload},editing?'PATCH':'POST');editing=null;});};
 root.querySelector('#aviation-cancel').onclick=reset;
 root.querySelectorAll('[data-apply]').forEach(b=>b.onclick=()=>{const i=items.find(i=>i.id===b.dataset.apply);apply(i.payload);});
 root.querySelectorAll('[data-edit-personal]').forEach(b=>b.onclick=()=>{const i=items.find(i=>i.id===b.dataset.editPersonal);editing=i.id;form.elements.kind.value=i.kind;form.elements.kind.disabled=true;form.elements.title.value=i.title;form.elements.text.value=i.payload.text||'';form.querySelector('.primary').textContent='수정 저장';root.querySelector('#aviation-cancel').hidden=false;form.elements.title.focus();});
 root.querySelectorAll('[data-delete-personal]').forEach(b=>b.onclick=()=>{if(confirm('이 개인 기록을 삭제할까요?'))void run(b,()=>request('/aviation/personal/'+b.dataset.deletePersonal,null,'DELETE'));});
 }
 await load();
}
