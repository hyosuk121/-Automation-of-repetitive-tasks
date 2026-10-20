import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readApiResponse } from '../web/api-response.js';

test('plain-text Vercel 404 becomes an actionable route error without exposing body',async()=>{
  await assert.rejects(
    ()=>readApiResponse(new Response('The page could not be found\nNOT_FOUND\ninternal deployment details',{status:404})),
    error=>error.message.includes('HTTP 404') && !error.message.includes('Unexpected token') && !error.message.includes('internal')
  );
});
test('HTML gateway failure and invalid JSON success are not misreported as password errors',async()=>{
  await assert.rejects(()=>readApiResponse(new Response('<html>Gateway Timeout</html>',{status:504})),/시간이 초과/);
  await assert.rejects(()=>readApiResponse(new Response('<html>App</html>',{status:200})),/올바른 응답/);
  await assert.rejects(()=>readApiResponse(new Response('null')),/응답 형식/);
});
test('structured authentication errors and successful responses retain their meaning',async()=>{
  await assert.rejects(()=>readApiResponse(new Response('{"error":"이메일 또는 비밀번호를 확인해 주세요."}',{status:401})),/이메일 또는 비밀번호/);
  assert.deepEqual(await readApiResponse(new Response('{"user":{"id":"test"}}')),{user:{id:'test'}});
});
