// Each response commits one app. A retry is safe because the server owns the import ledger.
export async function importInSteps(mappings,request,onProgress=()=>{}){
 if(!mappings.length)throw new Error('가져올 항목을 선택해 주세요.');
 if(new Set(mappings.map(m=>m.appId)).size!==mappings.length)throw new Error('같은 앱을 여러 항목에 연결할 수 없습니다. 연결을 확인해 주세요.');
 let imported=0,skipped=0;
 for(const [index,mapping]of mappings.entries()){
  onProgress({completed:index,total:mappings.length,mapping,done:false});
  const result=await request(mapping);
  imported+=result.imported;skipped+=result.skipped;
  onProgress({completed:index+1,total:mappings.length,mapping,done:true});
 }
 return {imported,skipped};
}
