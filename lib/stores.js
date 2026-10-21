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
  const origin = new URL(url).origin;
  const signal = AbortSignal.timeout(18000);
  try {
    for (let redirects=0; redirects<=3; redirects++) {
      response = await fetch(url, { signal, redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AppUpdateMonitor/1.0)', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7' } });
      if (![301,302,303,307,308].includes(response.status)) break;
      const location=response.headers.get('location');
      await response.body?.cancel();
      const next=new URL(location || '',url);
      if (!location || redirects===3 || next.origin!==origin || next.username || next.password)
        throw new CollectionError('허용되지 않는 스토어 리디렉션', 'redirect');
      url=next.href;
    }
  } catch(error) {
    if(error instanceof CollectionError)throw error;
    throw new CollectionError('스토어 연결 시간 초과 또는 네트워크 오류', 'network', true);
  }
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('retry-after')) || 60;
    throw new CollectionError(`스토어 응답 HTTP ${response.status}`, `http_${response.status}`, response.status >= 500 || response.status === 429, retryAfter);
  }
  const body = await response.text();
  if (body.length > 12_000_000) throw new CollectionError('스토어 응답 크기 제한 초과', 'response_size');
  return body;
}

// Preserve paragraph/bullet line breaks without executing source markup.
export function storeText(value) {
  if (typeof value !== 'string') return null;
  if (!/<(?:br|p|div|li|ul|ol|span)\b/i.test(value)) return value.trim();
  const $=load(value);
  $('script,style').remove();
  $('br').replaceWith('\n');
  $('p,div,li').append('\n');
  return $.root().text().replace(/\r\n/g,'\n').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function releaseDate(value) {
  if(typeof value==='number') value=new Date(value<1e12?value*1000:value).toISOString();
  if(typeof value!=='string')return null;
  value=value.trim().replace(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/,(_,y,m,d)=>`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
  return /\d{4}/.test(value) && Number.isFinite(Date.parse(value))?value:null;
}
export function parseAppleHistory(html) {
  const $ = load(html), candidates=[];
  function accept(items) {
    if(!Array.isArray(items) || !items.length)return;
    const releases=items.map(v=>({
      version: typeof (v.versionDisplay ?? v.version)==='string' ? (v.versionDisplay ?? v.version).trim() : '',
      releaseDate: releaseDate(v.releaseDate ?? v.releaseTimestamp ?? v.date),
      notes: storeText(v.releaseNotes ?? v.notes ?? v.description)
    }));
    // A partially understood array must not mark older releases as removed.
    if(releases.every(v=>v.version && v.releaseDate && v.notes!==null))
      candidates.push([...new Map(releases.map(v=>[JSON.stringify([v.version,v.releaseDate]),v])).values()]);
  }
  function visit(node, depth = 0) {
    if (depth>30 || node==null) return;
    if(typeof node==='string') {
      if(/^[\[{]/.test(node.trim()))try{visit(JSON.parse(node),depth+1);}catch{}
      return;
    }
    if(typeof node!=='object')return;
    if(node.versionHistory)accept(Array.isArray(node.versionHistory)?node.versionHistory:node.versionHistory.items);
    // Apple web (captured 2026-10-21): the full history is embedded in the
    // see-all action's pageData, not in a property named versionHistory.
    // Scope this to that page; overview paragraphs/reviews are not releases.
    if(node.page==='versionHistory' && Array.isArray(node.pageData?.shelves)){
      const shelves=node.pageData.shelves.filter(s=>s.contentType==='titledParagraph');
      const items=shelves.flatMap(s=>Array.isArray(s.items)?s.items:[]);
      accept(items.map(item=>{
        const date=releaseDate(item.secondarySubtitle);
        return {
          version:item.$kind==='TitledParagraph' && item.style==='detail'?item.primarySubtitle:null,
          releaseDate:date?new Date(date).toISOString().slice(0,10):null,
          notes:item.text
        };
      }));
    }
    for(const value of Object.values(node))visit(value,depth+1);
  }
  $('script[type="application/json"], script#serialized-server-data, script[id^="shoebox"]').each((_, el) => {
    try { visit(JSON.parse($(el).text())); } catch { /* Unknown payload stays partial. */ }
  });
  const dom=[];
  $('.version-history__item').each((_,el)=>{
    const row=$(el),notes=row.find('.version-history__item__release-notes, .we-truncate').first();
    const time=row.find('time').first();
    dom.push({version:row.find('.version-history__item__version-number').first().text(),
      releaseDate:time.attr('datetime') || time.attr('data-iso') || time.text(),
      notes:notes.length?notes.html():null});
  });
  accept(dom);
  return candidates.sort((a,b)=>b.length-a.length)[0] || null;
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
  return normalizePlay(result);
}

export function normalizePlay(result) {
  if (!result.title || !result.appId) throw new CollectionError('Play Store 필수 정보를 읽지 못했습니다.');
  const updated = result.updated && Number.isFinite(new Date(result.updated).getTime()) ? new Date(result.updated).toISOString() : null;
  const notes=storeText(result.recentChanges);
  const version=typeof result.version==='string' && !/^(VARY|Varies with device|기기에 따라 다릅니다|unknown)$/i.test(result.version.trim()) ? result.version.trim() || null : null;
  return {
    appName: result.title, developerName: result.developer ?? null, iconUrl: result.icon ?? null,
    version, sourceUpdatedAt: updated, rating: result.score ?? null,
    ratingCount: result.ratings ?? null, reviewCount: result.reviews ?? null, downloadsText: result.installs ?? null,
    latestNotes: notes,
    releases: updated && notes != null ? [{ version, releaseDate: updated, notes }] : [],
    historyComplete: false, quality: updated && notes != null ? 'complete' : 'partial',
    warning: updated && notes != null ? null : '업데이트 날짜 또는 새로운 기능을 확인하지 못했습니다.'
  };
}
