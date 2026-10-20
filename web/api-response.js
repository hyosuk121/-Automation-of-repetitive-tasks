// Hosting errors may be plain text or HTML. Never expose response bodies (which
// can contain infrastructure details) or a raw JSON parser exception to users.
export async function readApiResponse(response) {
  let data;
  try {
    data = JSON.parse(await response.text());
  } catch {
    if (response.status === 404) {
      throw new Error('서버 API 경로를 찾을 수 없습니다(HTTP 404). 최신 배포가 Ready인지 확인한 뒤 새로고침해 주세요.');
    }
    if (response.status === 504) {
      throw new Error('서버 응답 시간이 초과되었습니다(HTTP 504). 잠시 후 다시 시도해 주세요.');
    }
    throw new Error(`서버가 올바른 응답을 보내지 않았습니다(HTTP ${response.status}). Vercel 배포 상태와 Logs를 확인해 주세요.`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('서버 응답 형식이 올바르지 않습니다. 최신 배포를 확인해 주세요.');
  }
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `요청을 처리하지 못했습니다(HTTP ${response.status}).`);
  }
  return data;
}
