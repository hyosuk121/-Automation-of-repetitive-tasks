import {escape,ratingLabel} from './chart-utils.js';
import {rankColor} from './rankings.js';
export function ratingChart(snapshots,name){
 const byDay=new Map();
 for(const s of [...snapshots].sort((a,b)=>new Date(a.collected_at)-new Date(b.collected_at))){
  const day=new Date(new Date(s.collected_at).getTime()+9*3600000).toISOString().slice(0,10);byDay.set(day,s);
 }
 const ordered=[...byDay].sort(([a],[b])=>a.localeCompare(b));
 const hasRating=([,s])=>s.rating!=null&&Number.isFinite(Number(s.rating));
 const first=ordered.findIndex(hasRating),last=ordered.findLastIndex(hasRating);
 const series=first<0?[]:ordered.slice(first,last+1),x=i=>60+(Date.parse(series[i]?.[0]||'1970-01-01')-Date.parse(series[0]?.[0]||'1970-01-01'))/Math.max(86400000,Date.parse(series.at(-1)?.[0]||'1970-01-01')-Date.parse(series[0]?.[0]||'1970-01-01'))*820,y=n=>290-Number(n)/5*260;
 let parts=[],points=[];
 for(const [i,[,s]]of series.entries()){
  if(s.rating!=null&&Number.isFinite(Number(s.rating)))points.push(`${x(i)},${y(s.rating)}`);
  else if(points.length){parts.push(points);points=[];}
 }
 if(points.length)parts.push(points);
 return `<section class="rating-chart rank-chart"><h3>일별 평점</h3><p>조회된 날짜별 마지막 수집값 · 5점 만점</p><div class="rank-plot"><svg viewBox="0 0 940 345" role="group" aria-label="일별 평점 추이">${[0,1,2,3,4,5].map(n=>`<line x1="60" x2="880" y1="${y(n)}" y2="${y(n)}" stroke="#e6eaf5"/><text x="15" y="${y(n)+4}">${n.toFixed(2)}</text>`).join('')}${parts.map(p=>`<polyline points="${p.join(' ')}" fill="none" stroke="${rankColor(name)}" stroke-width="2"/>`).join('')}${series.map(([day,s],i)=>s.rating==null?'':`<circle data-chart-point tabindex="0" role="button" aria-label="${escape(name)} - ${ratingLabel(s.rating)}점&#10;${day}" cx="${x(i)}" cy="${y(s.rating)}" r="5" fill="${rankColor(name)}" stroke="#fff"/>`).join('')}${series.filter((_,i)=>i===0||i===series.length-1||i===Math.floor(series.length/2)).map(([d])=>`<text x="${x(series.findIndex(([day])=>day===d))}" y="325" text-anchor="middle">${d}</text>`).join('')}</svg></div>${parts.length?'':'<p>표시할 평점 데이터가 없습니다.</p>'}<div class="rank-tooltip" role="tooltip" hidden></div></section>`;
}
