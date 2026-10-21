const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={outside:'순위권 밖',failed:'수집 실패',uncollected:'미수집',queued:'대기 중',running:'수집 중'};
export const rankLabel=r=>r?.status==='ranked'?`${r.rank}위`:labels[r?.status]||'미수집';
const colors=['#4962e8','#e16c33','#189b83','#a050c9','#cc4472','#598620','#247fa8','#ad802d','#525a79','#b7443d','#21806f','#845dcc'];
export function rankingsView(data,{platform='app_store',days=30,app='all'}={}){
 const all=(data?.rows||[]).filter(r=>r.platform===platform);
 const names=[...new Map(all.map(r=>[r.app_id,r.name])).entries()];
 const rows=all.filter(r=>app==='all'||r.app_id===app);
 const dates=[...new Set(all.map(r=>r.day))];
 const selected=names.filter(([id])=>app==='all'||app===id);
 const x=d=>60+(Math.max(0,dates.indexOf(d)) / Math.max(1,dates.length-1))*820;
 const y=rank=>30+(rank-1)/99*260;
 const chart=selected.map(([id,name],i)=>{
  let segments=[],points=[];
  for(const r of rows.filter(r=>r.app_id===id)){
   if(r.status==='ranked')points.push(`${x(r.day)},${y(r.rank)}`);
   else if(points.length){segments.push(points);points=[];}
  }
  if(points.length)segments.push(points);
  return segments.map(p=>`<polyline points="${p.join(' ')}" fill="none" stroke="${colors[i%colors.length]}" stroke-width="2"/>`).join('')+
   rows.filter(r=>r.app_id===id&&r.status==='ranked').map(r=>`<circle cx="${x(r.day)}" cy="${y(r.rank)}" r="3" fill="${colors[i%colors.length]}"><title>${escape(name)} · ${r.day} · ${r.rank}위</title></circle>`).join('');
 }).join('');
 const recent=selected.map(([id,name])=>{const series=rows.filter(r=>r.app_id===id),r=series.at(-1),prev=series.at(-2);const delta=r?.status==='ranked'&&prev?.status==='ranked'?prev.rank-r.rank:null;return `<tr><td>${escape(name)}</td><td>${escape(r?.day||'—')}</td><td>${rankLabel(r)}</td><td>${delta==null?'—':delta>0?`▲ ${delta}`:delta<0?`▼ ${-delta}`:'변동 없음'}</td><td>${r?.collected_at?escape(new Date(r.collected_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})):'—'}</td></tr>`;}).join('');
 return `<section class="data-panel"><div class="panel-heading"><h2>대한민국 · 인기 무료 · 상위 100위</h2><button class="button secondary small" data-rank-refresh>새로고침</button></div><div class="table-toolbar rank-toolbar"><label>스토어 <select id="rank-platform"><option value="app_store" ${platform==='app_store'?'selected':''}>App Store · iPhone 여행</option><option value="play_store" ${platform==='play_store'?'selected':''}>Play Store · 여행 및 지역정보</option></select></label><label>기간 <select id="rank-days">${[7,30,90].map(n=>`<option value="${n}" ${days===n?'selected':''}>최근 ${n}일</option>`).join('')}</select></label><label>경쟁사 <select id="rank-app"><option value="all">전체</option>${names.map(([id,name])=>`<option value="${id}" ${app===id?'selected':''}>${escape(name)}</option>`).join('')}</select></label></div>
 <div class="rank-chart"><p>1위가 위쪽입니다. 수집 실패·미수집·순위권 밖은 선으로 연결하지 않습니다.</p><svg viewBox="0 0 940 345" role="img" aria-label="일별 카테고리 순위 추이. 상세 수치는 아래 일별 데이터 표에서 확인할 수 있습니다.">${[1,25,50,75,100].map(n=>`<line x1="60" x2="880" y1="${y(n)}" y2="${y(n)}" stroke="#e6eaf5"/><text x="15" y="${y(n)+4}">${n}위</text>`).join('')}${chart}${dates.filter((_,i)=>i===0||i===dates.length-1||i===Math.floor(dates.length/2)).map(d=>`<text x="${x(d)}" y="325" text-anchor="middle">${d}</text>`).join('')}</svg><div class="rank-legend">${selected.map(([,name],i)=>`<span style="color:${colors[i%colors.length]}">● ${escape(name)}</span>`).join('')}</div>${!rows.some(r=>r.status==='ranked')?'<p>아직 표시할 순위가 없습니다. 미수집과 수집 실패는 순위권 밖을 의미하지 않습니다.</p>':''}</div>
 <div class="table-scroll"><table><thead><tr><th>경쟁사</th><th>기준일</th><th>오늘 순위</th><th>전일 대비</th><th>실제 수집 시각</th></tr></thead><tbody>${recent}</tbody></table></div>
 <details class="rank-data"><summary>일별 데이터 보기</summary><div class="table-scroll"><table><thead><tr><th>날짜</th><th>경쟁사</th><th>순위 / 상태</th></tr></thead><tbody>${[...rows].reverse().map(r=>`<tr><td>${escape(r.day)}</td><td>${escape(r.name)}</td><td>${rankLabel(r)}</td></tr>`).join('')}</tbody></table></div></details></section>`;
}
