export const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const ratingLabel=value=>value==null||value===''||!Number.isFinite(Number(value))?'—':(Math.round((Number(value)+Number.EPSILON)*100)/100).toFixed(2);
export function checkboxFilter(names,selected,kind){
 const checked=id=>selected==='all'||(Array.isArray(selected)?selected.includes(id):selected===id);
 return `<details class="multi-filter"><summary>경쟁사 · ${selected==='all'?'전체':selected.length+'개 선택'}</summary><fieldset><legend class="sr-only">경쟁사 선택</legend><label><input type="checkbox" data-${kind}-all ${names.every(([id])=>checked(id))?'checked':''}>전체 선택</label>${names.map(([id,name])=>`<label><input type="checkbox" data-${kind}-app value="${escape(id)}" ${checked(id)?'checked':''}>${escape(name)}</label>`).join('')}</fieldset></details>`;
}
export function bindChartTooltip(root){
 const tooltip=root.querySelector('[role="tooltip"]');if(!tooltip)return;
 const hide=()=>{tooltip.hidden=true;};
 root.querySelectorAll('[data-chart-point]').forEach(point=>{
  const show=()=>{
   tooltip.textContent=point.getAttribute('aria-label');tooltip.hidden=false;
   const box=point.getBoundingClientRect();
   tooltip.style.left=Math.max(8,Math.min(box.left,window.innerWidth-tooltip.offsetWidth-8))+'px';
   tooltip.style.top=Math.max(8,box.top-tooltip.offsetHeight-12)+'px';
  };
  point.addEventListener('mouseenter',show);point.addEventListener('mouseleave',hide);
  point.addEventListener('focus',show);point.addEventListener('blur',hide);point.addEventListener('click',show);
  point.addEventListener('keydown',e=>{if(e.key==='Escape')hide();});
 });
 root.addEventListener('scroll',hide,{capture:true});
}
