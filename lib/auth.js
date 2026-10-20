import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { fail } from './repository.js';

export function configuration() {
  return {
    database: Boolean(process.env.DATABASE_URL),
    authentication: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.ADMIN_EMAILS),
    origin: Boolean(process.env.APP_ORIGIN),
    scheduler: Boolean(process.env.CRON_SECRET)
  };
}
function authClient() {
  if (!configuration().authentication) fail('관리자 인증 설정이 필요합니다.',503);
  return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
export function allowedEmail(email) {
  return (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean).includes(email?.toLowerCase());
}
export function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(p => p.trim().split(/=(.*)/s)).filter(p => p.length>1).map(([k,v]) => [k,v]));
}
export function setSession(res, session) {
  const secure = process.env.APP_ORIGIN?.startsWith('https://') ? '; Secure' : '';
  const cookie = (name,value,age) => `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`;
  res.setHeader('Set-Cookie',[
    cookie('automation_access',session?.access_token || '',session ? (session.expires_in || 3600) : 0),
    cookie('automation_refresh',session?.refresh_token || '',session ? 7*86400 : 0)
  ]);
}
export async function signIn(email,password) {
  if (!allowedEmail(email)) fail('이메일 또는 비밀번호를 확인해 주세요.',401);
  const {data,error}=await authClient().auth.signInWithPassword({email,password});
  if(error || !allowedEmail(data.user?.email)) fail('이메일 또는 비밀번호를 확인해 주세요.',401);
  return data;
}
export async function refresh(req) {
  const token = cookies(req).automation_refresh;
  if (!token) fail('다시 로그인해 주세요.',401);
  const {data,error}=await authClient().auth.refreshSession({refresh_token:token});
  if(error || !allowedEmail(data.user?.email)) fail('다시 로그인해 주세요.',401);
  return data;
}
export async function requireUser(req) {
  const token = cookies(req).automation_access;
  if (!token) fail('로그인이 필요합니다.',401);
  const {data,error} = await authClient().auth.getUser(token);
  if(error || !data.user || !allowedEmail(data.user.email)) fail('로그인이 만료되었거나 권한이 없습니다.',401);
  return data.user;
}
export function checkOrigin(req) {
  const expected = process.env.APP_ORIGIN;
  if (!expected) fail('APP_ORIGIN 설정이 필요합니다.',503);
  if (req.headers.origin !== new URL(expected).origin) fail('허용되지 않은 요청 출처입니다.',403);
}
export function checkCron(req) {
  const actual = req.headers.authorization || '', expected = `Bearer ${process.env.CRON_SECRET || ''}`;
  if (!process.env.CRON_SECRET || actual.length !== expected.length || !timingSafeEqual(Buffer.from(actual),Buffer.from(expected))) fail('허용되지 않은 작업 요청입니다.',401);
}
