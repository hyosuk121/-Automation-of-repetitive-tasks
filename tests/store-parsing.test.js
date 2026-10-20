import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAppleHistory,normalizeApple,normalizePlay,collectStore} from '../lib/stores.js';

// Representative release text from the supplied 0709 export. Store envelopes below
// are parser fixtures, not captured live Apple responses.
const releases=[
  {version:'1.10.6',releaseDate:'2026-06-24',notes:'- 안정적인 서비스를 위해 버그를 수정했어요.'},
  {version:'1.10.5',releaseDate:'2026-06-18',notes:'- 로밍도깨비 멤버십이 런칭되었어요.\n- 가이드 탭과 고객 지원 화면을 새롭게 추가했어요.'}
];
test('Apple history supports rendered version rows and preserves multiline notes',()=>{
  const html='<ul>'+releases.map(r=>`<li class="version-history__item"><h4 class="version-history__item__version-number">${r.version}</h4><time datetime="${r.releaseDate}">최근</time><div class="we-truncate"><p>${r.notes.replaceAll('\n','<br>')}</p></div></li>`).join('')+'</ul>';
  assert.deepEqual(parseAppleHistory(html),releases);
  assert.equal(parseAppleHistory(html.replace('datetime="2026-06-18"','datetime="not-a-date"')),null);
  assert.equal(parseAppleHistory('<h1>2.0</h1><time>2026-06-24</time><p>Unrelated content</p>'),null);
});
test('Apple recognizes encoded shoebox and structured histories, rejecting incomplete entries',()=>{
  const cache={response:JSON.stringify({data:{attributes:{versionHistory:releases}}})};
  assert.deepEqual(parseAppleHistory(`<script id="shoebox-media-api-cache-1">${JSON.stringify(cache)}</script>`),releases);
  const payload={versionHistory:{items:releases.map(r=>({versionDisplay:r.version,releaseDate:r.releaseDate,releaseNotes:r.notes}))}};
  assert.deepEqual(parseAppleHistory(`<script type="application/json">${JSON.stringify(payload)}</script>`),releases);
  assert.equal(parseAppleHistory('<script type="application/json">{"versionHistory":[{"version":"1.0","releaseDate":"2026-06-24"}]}</script>'),null);
});
test('latest records contain report fields; unknown Play version remains unknown',()=>{
  const apple=normalizeApple({trackId:123,trackName:'로밍도깨비',version:'1.10.6',currentVersionReleaseDate:'2026-06-24',averageUserRating:4.8,userRatingCount:5950,artworkUrl100:'https://is1-ssl.mzstatic.com/icon.jpg',releaseNotes:releases[0].notes},releases);
  assert.equal(apple.ratingCount,5950);assert.equal(apple.releases.length,2);assert.equal(apple.quality,'complete');assert.ok(apple.iconUrl);
  const source={appId:'com.example.app',title:'로밍도깨비',score:4.8,ratings:4000,reviews:3280,installs:'500,000+',updated:Date.parse('2026-06-25'),version:'VARY',recentChanges:'첫 줄<br>둘째 줄 &amp; 개선',icon:'https://play-lh.googleusercontent.com/icon'};
  const play=normalizePlay(source);
  assert.equal(play.version,null);assert.equal(play.reviewCount,3280);assert.equal(play.ratingCount,4000);
  assert.equal(play.downloadsText,'500,000+');assert.equal(play.sourceUpdatedAt,'2026-06-25T00:00:00.000Z');
  assert.equal(play.latestNotes,'첫 줄\n둘째 줄 & 개선');assert.equal(play.iconUrl,source.icon);
  assert.equal(normalizePlay({...source,version:'2.3.1'}).version,'2.3.1');
});
test('Apple collection follows official same-origin redirects but never third-party destinations',async()=>{
  const original=globalThis.fetch;
  const app={platform:'app_store',external_id:'123',country:'kr',store_url:'https://apps.apple.com/kr/app/id123'};
  const calls=[];
  let unsafe=false;
  globalThis.fetch=async(url,options)=>{
    calls.push(String(url));assert.equal(options.redirect,'manual');
    if(String(url).startsWith('https://itunes.apple.com/'))return new Response(JSON.stringify({resultCount:1,results:[{trackId:123,trackName:'App',version:'1.10.6'}]}));
    if(url===app.store_url)return new Response(null,{status:301,headers:{location:unsafe?'https://evil.test/secret':'/kr/app/name/id123'}});
    return new Response(`<script id="serialized-server-data">${JSON.stringify({versionHistory:releases})}</script>`);
  };
  try {
    const complete=await collectStore(app);assert.equal(complete.quality,'complete');assert.equal(complete.releases.length,2);
    unsafe=true;calls.length=0;
    const partial=await collectStore(app);assert.equal(partial.quality,'partial');assert.equal(partial.historyComplete,false);
    assert.ok(!calls.some(url=>url.includes('evil.test')));
  } finally{globalThis.fetch=original;}
});
