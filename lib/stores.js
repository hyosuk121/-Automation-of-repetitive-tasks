import { load } from 'cheerio';
import gplay from 'google-play-scraper';

export class CollectionError extends Error {
  constructor(message, code = 'parse', retryable = false, retryAfter = 0) {
    super(message); Object.assign(this, { code, retryable, retryAfter });
  }
}
export function parseStoreUrl(value, platform) {
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error('올바른 스토어 URL을 입력해 주세요.'), { status: 400 }); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw Object.assign(new Error('공식 HTTPS 스토어 링크만 사용할 수 있습니다.'), { status: 400 });
  if (platform === 'app_store' && url.hostname === 'apps.apple.com') {
    const match = url.pathname.match(/^\/([a-z]{2})\/app\/(?:[^/]+\/)?id(\d+)\/?$/i);
    if (match) return { platform, external_id: match[2], country: match[1].toLowerCase(), language: 'ko', store_url: `https://apps.apple.com/${match[1].toLowerCase()}/app/id${match[2]}` };
  }
  if (platform === 'play_store' && url.hostname === 'play.google.com' && url.pathname === '/store/apps/details') {
    const id = url.searchParams.get('id'), country = (url.searchParams.get('gl') || 'kr').toLowerCase(), language = url.searchParams.get('hl') || 'ko';
    if (/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+$/.test(id || '') && /^[a-z]{2}$/.test(country) && /^[a-z]{2}(?:[-_][A-Z]{2})?$/.test(language))
      return { platform, external_id: id, country, language, store_url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}&gl=${country}&hl=${language}` };
  }
  throw Object.assign(new Error('지원하는 App Store 또는 Play Store 앱 상세 링크가 아닙니다.'), { status: 400 });
}

async function request(url) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(18000), redirect: 'error', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AppUpdateMonitor/1.0)', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7' } });
  } catch { throw new CollectionError('스토어 연결 시간 초과 또는 네트워크 오류', 'network', true); }
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('retry-after')) || 60;
    throw new CollectionError(`스토어 응답 HTTP ${response.status}`, `http_${response.status}`, response.status >= 500 || response.status === 429, retryAfter);
  }
  const body = await response.text();
  if (body.length > 12_000_000) throw new CollectionError('스토어 응답 크기 제한 초과', 'response_size');
  return body;
}

// Only a recognized, nonempty versionHistory array proves history parsing succeeded.
// Latest-only fallback must never mark old releases missing.
export function parseAppleHistory(html) {
  const $ = load(html);
  let found = null;
  function visit(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 30) return;
    if (Array.isArray(node.versionHistory) && node.versionHistory.length) {
      const releases = node.versionHistory.map(v => ({
        version: String(v.versionDisplay ?? v.version ?? ''),
        releaseDate: v.releaseDate ?? v.releaseTimestamp ?? null,
        notes: v.releaseNotes ?? v.notes ?? ''
      }));
      if (releases.every(v => v.version && v.releaseDate && typeof v.notes === 'string')) found = releases;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(x => visit(x, depth + 1));
      else visit(value, depth + 1);
    }
  }
  $('script[type="application/json"], script#serialized-server-data').each((_, el) => {
    try { visit(JSON.parse($(el).text())); } catch { /* Unknown payload: partial, not missing. */ }
  });
  return found;
}

export function normalizeApple(data, history) {
  if (!data?.trackName || !data?.trackId || !data?.version) throw new CollectionError('Apple 응답에 필수 앱 정보가 없습니다.');
  return {
    appName: data.trackName, developerName: data.artistName ?? null,
    iconUrl: data.artworkUrl512 || data.artworkUrl100 || null,
    version: data.version, sourceUpdatedAt: data.currentVersionReleaseDate ?? null,
    rating: data.averageUserRating ?? null, ratingCount: data.userRatingCount ?? null,
    reviewCount: null, downloadsText: null, latestNotes: data.releaseNotes ?? null,
    releases: history || [{ version: data.version, releaseDate: data.currentVersionReleaseDate ?? null, notes: data.releaseNotes ?? '' }],
    historyComplete: Boolean(history), quality: history ? 'complete' : 'partial',
    warning: history ? null : '버전 기록을 확인하지 못해 최신 버전만 보존했습니다. 이전 버전의 미노출 여부는 변경하지 않습니다.'
  };
}

export async function collectStore(app) {
  if (app.platform === 'app_store') {
    const lookup = JSON.parse(await request(`https://itunes.apple.com/lookup?id=${app.external_id}&country=${app.country}`));
    if (!lookup.resultCount) throw new CollectionError('해당 국가의 스토어에서 앱을 찾지 못했습니다.', 'not_found');
    let history = null;
    try { history = parseAppleHistory(await request(app.store_url)); } catch { /* Keep Lookup result as partial. */ }
    return normalizeApple(lookup.results[0], history);
  }
  let result;
  try {
    result = await gplay.app({
      appId: app.external_id, country: app.country, lang: app.language,
      requestOptions: { timeout: { request: 20000 }, retry: { limit: 0 } }
    });
  } catch (error) {
    const status = error.status || error.statusCode || error.response?.statusCode;
    const retryable = status === 429 || status >= 500 || /ETIMEDOUT|Timeout|timed out|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(error.message);
    throw new CollectionError(status === 404 ? 'Play Store에서 앱을 찾지 못했습니다.' : 'Play Store 수집 또는 파싱에 실패했습니다.', status ? `http_${status}` : 'parse', retryable);
  }
  if (!result.title || !result.appId) throw new CollectionError('Play Store 필수 정보를 읽지 못했습니다.');
  const updated = result.updated ? new Date(result.updated).toISOString() : null;
  return {
    appName: result.title, developerName: result.developer ?? null, iconUrl: result.icon ?? null,
    version: null, sourceUpdatedAt: updated, rating: result.score ?? null,
    ratingCount: null, reviewCount: result.reviews ?? null, downloadsText: result.installs ?? null,
    latestNotes: result.recentChanges ?? null,
    releases: updated && result.recentChanges != null ? [{ version: null, releaseDate: updated, notes: result.recentChanges }] : [],
    historyComplete: false, quality: updated && result.recentChanges != null ? 'complete' : 'partial',
    warning: updated && result.recentChanges != null ? null : '업데이트 날짜 또는 새로운 기능을 확인하지 못했습니다.'
  };
}
