import ExcelJS from 'exceljs';
import { fail } from './repository.js';

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const safeCell = value => /^[=+\-@\t\r]/.test(String(value ?? '')) ? `'${value}` : String(value ?? '');
const htmlCell = (key,value) => {
  if(key==='icon_url' && /^https:\/\//.test(value || ''))return `<img src="${escapeHtml(value)}" width="48" height="48" alt="앱 아이콘" referrerpolicy="no-referrer">`;
  if(key==='release_history' && Array.isArray(value))return value.map(r=>`<section><strong>${escapeHtml(r.version || '버전 알 수 없음')} · ${escapeHtml(r.release_date)}</strong>${(r.notes || []).map(n=>`<p>${escapeHtml(n)}</p>`).join('')}</section>`).join('');
  return escapeHtml(value!=null && typeof value==='object'?JSON.stringify(value):String(value??''));
};
export async function exportData(database,owner,{mode='latest',format='xlsx',from,to}) {
  let rows;
  const params=[owner,from,to];
  if(mode==='latest') {
    rows=(await database.query(`SELECT c.name,c.service_scope,a.platform,a.store_url,s.collected_at,s.app_name,s.icon_url,s.version,s.source_updated_at,s.rating,s.rating_count,s.review_count,s.downloads_text,s.latest_notes,
      (SELECT jsonb_agg(jsonb_build_object('version',rh.version,'release_date',rh.release_date,'notes',(SELECT jsonb_agg(n.notes ORDER BY n.last_seen_at DESC) FROM release_note_revisions n WHERE n.release_history_id=rh.id))) FROM release_history rh WHERE rh.store_app_id=a.id) release_history
      FROM competitors c JOIN store_apps a ON a.competitor_id=c.id AND a.is_active
      LEFT JOIN LATERAL(SELECT * FROM store_snapshots ss WHERE ss.store_app_id=a.id ORDER BY collected_at DESC LIMIT 1)s ON true
      WHERE c.owner_id=$1 AND c.archived_at IS NULL ORDER BY c.sort_order,a.platform LIMIT 50001`,[owner])).rows;
  } else if(mode==='snapshots') {
    rows=(await database.query(`SELECT c.name,a.platform,s.collected_at,s.version,s.rating,s.rating_count,s.review_count,s.downloads_text,s.latest_notes
      FROM store_snapshots s JOIN store_apps a ON a.id=s.store_app_id JOIN competitors c ON c.id=a.competitor_id
      WHERE c.owner_id=$1 AND s.collected_at BETWEEN $2 AND $3 ORDER BY s.collected_at LIMIT 50001`,params)).rows;
  } else if(mode==='releases') {
    rows=(await database.query(`SELECT c.name,a.platform,r.version,r.release_date,r.first_seen_at,r.last_seen_at,r.missing_since,r.is_present_in_source,n.notes,n.first_seen_at AS note_first_seen_at,n.last_seen_at AS note_last_seen_at
      FROM release_history r JOIN store_apps a ON a.id=r.store_app_id JOIN competitors c ON c.id=a.competitor_id
      LEFT JOIN release_note_revisions n ON n.release_history_id=r.id
      WHERE c.owner_id=$1 AND r.first_seen_at <= $3 AND r.last_seen_at >= $2 ORDER BY c.sort_order,r.first_seen_at LIMIT 50001`,params)).rows;
  } else if(mode==='changes') {
    rows=(await database.query(`SELECT c.name,a.platform,e.occurred_at,e.field,e.old_value,e.new_value FROM change_events e
      JOIN store_apps a ON a.id=e.store_app_id JOIN competitors c ON c.id=a.competitor_id
      WHERE c.owner_id=$1 AND e.occurred_at BETWEEN $2 AND $3 ORDER BY e.occurred_at LIMIT 50001`,params)).rows;
  } else fail('지원하지 않는 내보내기 범위입니다.');
  if(rows.length>50000) fail('한 번에 50,000개까지 내보낼 수 있습니다. 기간을 줄여 주세요.',413);
  rows=rows.map(row=>({...row,...(row.rating!=null?{rating:(Math.round((Number(row.rating)+Number.EPSILON)*100)/100).toFixed(2)}:{}),...(row.field==='rating'?{old_value:row.old_value==null?null:(Math.round((Number(row.old_value)+Number.EPSILON)*100)/100).toFixed(2),new_value:row.new_value==null?null:(Math.round((Number(row.new_value)+Number.EPSILON)*100)/100).toFixed(2)}:{})}));
  const metadata={generatedAt:new Date().toISOString(),timeZone:'Asia/Seoul',mode,period:mode==='latest'?'최신 상태':{from,to}};
  const formatDate = value => value instanceof Date ? value.toLocaleString('sv-SE',{timeZone:'Asia/Seoul'})+' KST' : value;
  rows=rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,formatDate(v)])));
  const columns=Object.keys(rows[0] || {result:''});
  const cell=v=>v!=null && typeof v==='object'?JSON.stringify(v):String(v??'');
  const metaText=JSON.stringify(metadata);
  if(format==='json') return {body:JSON.stringify({metadata,rows},null,2),type:'application/json',ext:'json'};
  if(format==='xlsx') {
    const book=new ExcelJS.Workbook();
    const meta=book.addWorksheet('조회 정보');
    for(const [k,v]of Object.entries(metadata)) meta.addRow([k,cell(v)]);
    const sheet=book.addWorksheet('결과');
    sheet.columns=columns.map(key=>({header:key,key,width:key.includes('notes')?65:24}));
    if(rows.some(row=>Object.values(row).some(v=>cell(v).length>32767)))fail('Excel 셀의 글자 수 제한을 초과했습니다. 전체 내용을 보존하려면 HTML 또는 JSON으로 내보내 주세요.',422);
    rows.forEach(row=>sheet.addRow(Object.fromEntries(Object.entries(row).map(([k,v])=>[k,safeCell(cell(v))]))));
    sheet.getRow(1).font={bold:true};
    sheet.views=[{state:'frozen',ySplit:1}];
    return {body:await book.xlsx.writeBuffer(),type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ext:'xlsx'};
  }
  if(format==='csv') {
    const csv=values=>values.map(v=>`"${safeCell(cell(v)).replaceAll('"','""')}"`).join(',');
    return {body:'\uFEFF'+csv(['metadata',metaText])+'\r\n'+csv(columns)+'\r\n'+rows.map(r=>csv(columns.map(c=>r[c]))).join('\r\n'),type:'text/csv; charset=utf-8',ext:'csv'};
  }
  if(format==='markdown') {
    const md=v=>cell(v).replaceAll('|','\\|').replaceAll('\n','<br>').replaceAll('<','&lt;');
    return {body:`# 경쟁사 앱 업데이트\n\n${metaText}\n\n| ${columns.join(' | ')} |\n| ${columns.map(()=>'---').join(' | ')} |\n${rows.map(r=>'| '+columns.map(c=>md(r[c])).join(' | ')+' |').join('\n')}`,type:'text/markdown; charset=utf-8',ext:'md'};
  }
  if(format==='html') return {
    body:`<!doctype html><html lang="ko"><meta charset="utf-8"><title>경쟁사 앱 업데이트</title><style>body{font:14px system-ui;padding:32px;color:#192135}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:12px;white-space:pre-wrap;text-align:left}th{background:#eef2ff}section{min-width:240px;margin:12px 0}</style><h1>경쟁사 앱 업데이트</h1><p>${escapeHtml(metaText)}</p><table><thead><tr>${columns.map(c=>`<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${columns.map(c=>`<td>${htmlCell(c,r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></html>`,
    type:'text/html; charset=utf-8',ext:'html'
  };
  fail('지원하지 않는 파일 형식입니다.');
}
