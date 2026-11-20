const countries=['JP','VN','CN','TW','HK','MO','TH','US'];
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function validatePersonal(data){
 if(!['preferences','filter','note'].includes(data.kind))fail('저장 종류를 확인해 주세요.');
 const title=typeof data.title==='string'?data.title.trim():'';
 if(!title||title.length>80)fail('이름은 1~80자로 입력해 주세요.');
 const p=data.payload;
 if(!p||typeof p!=='object'||!Array.isArray(p.countries)||p.countries.some(c=>!countries.includes(c)))fail('국가 선택을 확인해 주세요.');
 if(typeof p.month!=='string'||p.month!==''&&!/^20\d{2}-(0[1-9]|1[0-2])$/.test(p.month)||p.month&&p.month<'2021-01')fail('기준월을 확인해 주세요.');
 if(!['market','recent'].includes(p.tab))fail('화면을 확인해 주세요.');
 const text=typeof p.text==='string'?p.text.trim():'';
 if(data.kind==='note'&&(!text||text.length>5000))fail('메모는 1~5000자로 입력해 주세요.');
 return {kind:data.kind,title,payload:{month:p.month,tab:p.tab,countries:[...new Set(p.countries)],...(data.kind==='note'?{text}: {})}};
}
export async function listPersonal(db,owner){return (await db.query('SELECT id,kind,title,payload,updated_at FROM aviation_personal WHERE owner_id=$1 ORDER BY updated_at DESC,id',[owner])).rows;}
export async function savePersonal(db,owner,data,id=null){
 const v=validatePersonal(data);
 if(id){const result=await db.query('UPDATE aviation_personal SET title=$3,payload=$4,updated_at=now() WHERE owner_id=$1 AND id=$2 AND kind=$5 RETURNING id',[owner,id,v.title,JSON.stringify(v.payload),v.kind]);if(!result.rows.length)fail('저장 항목을 찾을 수 없습니다.',404);return result.rows[0];}
 if(v.kind==='preferences')return (await db.query("INSERT INTO aviation_personal(owner_id,kind,title,payload) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id) WHERE kind='preferences' DO UPDATE SET payload=EXCLUDED.payload,title=EXCLUDED.title,updated_at=now() RETURNING id",[owner,v.kind,v.title,JSON.stringify(v.payload)])).rows[0];
 return (await db.query('INSERT INTO aviation_personal(owner_id,kind,title,payload) VALUES($1,$2,$3,$4) RETURNING id',[owner,v.kind,v.title,JSON.stringify(v.payload)])).rows[0];
}
export async function deletePersonal(db,owner,id){const result=await db.query('DELETE FROM aviation_personal WHERE owner_id=$1 AND id=$2 RETURNING id',[owner,id]);if(!result.rows.length)fail('저장 항목을 찾을 수 없습니다.',404);return {ok:true};}
