import {koreanDay} from './rankings.js';
export function rankingPeriod(params){
 const from=params.get('from'),to=params.get('to');
 if(from||to){
  const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
  if(!valid(from)||!valid(to)||from>to||to>koreanDay()||(Date.parse(to)-Date.parse(from))/86400000>=366)throw Object.assign(new Error('조회 기간은 오늘까지 최대 366일이며 시작일은 종료일 이전이어야 합니다.'),{status:400});
  return {from,to,country:'kr'};
 }
 const days=Math.floor(Math.min(90,Math.max(1,Number(params.get('days'))||30)));
 return {from:koreanDay(new Date(Date.now()-(days-1)*86400000)),to:koreanDay(),country:'kr'};
}
