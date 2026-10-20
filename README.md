# Automation Hub

경쟁사 앱 업데이트 조사 자동화를 먼저 제공하는 개인 관리자용 업무 포털입니다. 진입 화면은 파란색·보라색 헤더와 흰색 본문의 카드 캐러셀입니다. **경쟁사 앱 업데이트 조사 자동화**만 실행할 수 있고, Aircrew Monitoring은 준비 중입니다.

기존 로컬 프로젝트의 실제 소스/JSON이 제공되지 않아 전달된 전환 요청서를 기반으로 새로 구현했습니다. 기존 코드와의 동작 일치, 실제 데이터 이전 결과는 아직 검증되지 않았습니다.

## 구현된 기능

- PC/모바일 카드 탐색: 방향 버튼, 휠, 키보드, 터치 스크롤.
- Supabase 관리자 로그인: 서버 검증, HttpOnly 세션 쿠키, 허용 관리자 이메일, 변경 요청 Origin 검사.
- 경쟁사 등록·수정·보관, 국내/국외 구분, 드래그 및 버튼 정렬.
- App Store / Play Store 분리 대시보드, 검색·필터, 개별/전체 수집 요청.
- PostgreSQL 영속 작업 큐, 대상별 lease, 중복 실행 방지, 지수 백오프 및 중단 작업 회수.
- 수집 시점별 append-only 스냅샷, 릴리즈와 설명 개정 이력, 시점별 수치 및 변경 이벤트.
- 이전 스토어 링크의 이력 보존, 보관된 경쟁사 이력 조회.
- CSV / Markdown / JSON / HTML / XLSX 내보내기와 KST 기간 필터.
- 기존 JSON/백업의 반복 실행 가능한 가져오기 명령.
- 기본 매일 오전 9시(KST) 수집. Worker의 스케줄러와 Vercel Cron은 날짜별 작업 키를 공유합니다.

UI에 임의의 경쟁사나 수집 성공 결과를 넣지 않습니다. 연결되지 않은 환경에는 연결 안내와 빈 화면이 표시됩니다.

## 구성

```text
Vercel: Vite 정적 화면 + Node.js API
   ├─ Supabase Auth: 관리자 인증
   ├─ Supabase PostgreSQL: 업무 데이터 + 작업 큐
   └─ 작업 생성 → 별도 Node.js Worker → Apple / Google 스토어
```

**Vercel 배포만으로 Worker가 실행되지는 않습니다.** Render Background Worker, Railway 서비스 또는 장기 실행 Node.js 호스트에서 `npm run worker`를 실행해야 합니다. 브라우저를 닫아도 Worker가 계속 처리하며, 앱은 작업 상태를 조회합니다.

## 로컬 개발

Node.js 22.9 이상(검증 환경: Node.js 24), npm을 사용합니다.

```bash
npm ci
cp .env.example .env
# 아래 환경 변수 입력 후:
npm run db:migrate
npm run dev
```

다른 터미널 또는 별도 프로세스에서:

```bash
npm run worker
```

`npm run dev`는 Vite 4173, API 4174를 실행합니다. `.env`의 `APP_ORIGIN`은 브라우저에서 사용하는 출처와 정확히 같아야 합니다. 기본은 `http://localhost:4173`입니다.

Supabase가 없는 상태에서도 `npm ci && npm run dev`로 포털과 연결 안내를 확인하고, `npm test`로 임시 PostgreSQL에서 데이터 계층을 검증할 수 있습니다. 이 상태에서 실제 수집·저장은 할 수 없습니다.

프로덕션 로컬 실행:

```bash
npm run build
npm start
```

## Supabase 설정

현재 사용자 프로젝트에 맞춘 값과 연결 순서는 [배포 설정 안내](docs/deployment-settings.md)를 참고하세요. Supabase GitHub 연동용 설정과 SQL은 `supabase/` 표준 경로에 있습니다.

1. 프로젝트를 생성하고 Auth 설정에서 공개 회원가입을 비활성화합니다.
2. 관리자 이메일 계정을 생성합니다. 이메일·비밀번호 인증을 사용합니다.
3. 다음 변수는 서버/Worker의 보안 환경 변수로 설정합니다. `.env`를 커밋하지 마세요.

| 변수 | 용도 |
| --- | --- |
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_ANON_KEY` | Auth 요청용 publishable/anon key |
| `DATABASE_URL` | PostgreSQL 연결 URL. 서버·Worker 전용 |
| `DATABASE_CA_FILE` | 필요한 경우 DB 공급자의 검증 가능한 CA 파일 경로 |
| `ADMIN_EMAILS` | 허용 관리자 이메일. 쉼표로 구분 |
| `APP_ORIGIN` | 실제 웹 주소. 운영에서는 반드시 `https://...` |
| `CRON_SECRET` | Vercel Cron 인증값. 플랫폼 환경 설정에서 생성·입력 |
| `COLLECTION_INTERVAL_SECONDS` | 수동 재수집 최소 간격, 기본 300초 |
| `MAX_COMPETITORS` | 관리자별 활성 경쟁사 상한, 기본 100 |
| `SCHEDULE_HOUR_KST` | 하루 수집 시작 시각, 기본 9 |

`DATABASE_URL`은 브라우저에 노출하지 않습니다. API는 사용자를 인증하고 모든 조회·변경을 해당 사용자 ID로 제한합니다. 테이블은 RLS가 활성화되어 있고 브라우저용 정책은 열지 않습니다. 서버의 신뢰된 DB 연결이 필요합니다.

DB 연결은 TLS 인증서 검증을 유지합니다. URL에 `sslmode=no-verify` 같은 우회 옵션을 사용하지 마세요. Supabase 연결 메뉴의 호스트와 연결 방식을 사용하세요. Worker/마이그레이션에는 session pooler, 서버리스 API에는 transaction pooler를 사용할 수 있습니다. TLS 오류는 공급자의 CA와 올바른 호스트로 해결합니다.

```bash
npm run db:migrate
```

`supabase/migrations/20261020000000_initial.sql`은 테이블, 고유 키, 인덱스, RLS 및 스냅샷 수정·삭제 방지 트리거를 생성합니다. 마이그레이션은 트랜잭션과 DB 잠금 안에서 실행되며 재실행할 수 있습니다. 실제 DB에 적용하기 전 별도 스테이징 프로젝트에서 확인하세요.

## Vercel 및 Worker 배포

1. 이 저장소를 Vercel 프로젝트에 연결합니다. 프로젝트 루트는 저장소 루트입니다.
2. `vercel.json`의 build command `npm run build`, output `dist`, Node API 설정을 사용합니다.
3. Vercel 환경 설정에 위 변수를 등록하고, `APP_ORIGIN`을 배포 도메인으로 지정합니다.
4. 스테이징 DB에 마이그레이션 후 API 조회 및 인증을 확인합니다.
5. 별도 Worker 호스트에서 `npm ci --omit=dev` 후 `npm run worker`를 실행합니다. Worker에는 `DATABASE_URL`, 필요 시 `DATABASE_CA_FILE`, 수집 주기 변수가 필요합니다.
6. 관리자 로그인 → 경쟁사 등록 → 수집 완료 → 이력 조회 → XLSX 다운로드를 실제 운영 도메인에서 확인합니다.
7. Worker를 중단·재시작하여 대기 작업과 만료된 lease 복구를 확인합니다.

Vercel Cron은 UTC 00:00(KST 09:00)에 `/api/cron`을 호출하여 작업을 **등록만** 합니다. Worker는 1분 간격으로 일일 스케줄을 확인하고 큐를 처리합니다. 큐가 계속 대기 중이라면 Worker 실행 상태와 DB 연결을 확인하세요.

요청 한 건의 수집 타임아웃은 18~20초, Worker의 대상 lease는 3분입니다. 대상 하나씩 처리하며 수집 사이에 1.5초 간격을 둡니다. 네트워크/5xx/429 오류는 최초 시도 이후 최대 3회 재시도합니다. 한 앱의 실패가 다른 앱의 결과를 취소하지 않습니다.

## 과거 기록 보존 방식

- 수집 작업/대상 조합별 스냅샷은 한 번만 저장합니다. 별도 수집 작업은 내용이 같아도 새 관측값을 저장합니다.
- 스냅샷은 DB 트리거로 UPDATE/DELETE를 차단합니다.
- App Store 버전 목록을 완전하게 파싱한 경우에만 미확인 릴리즈를 표시합니다. Lookup fallback은 부분 성공이며 기존 릴리즈의 상태를 바꾸지 않습니다.
- Play Store의 최신 설명이 확인되면 이전 설명은 이력으로 남고 현재 응답에서 미확인 상태로 전환됩니다. 버전 번호는 추측하지 않고 null로 보존합니다.
- `missing_since`는 실제 삭제일이 아닌 **처음 미노출을 관측한 시점**입니다.
- 스토어 링크의 앱 ID/국가/언어가 바뀌면 별도 수집 대상을 만듭니다. 상세 화면에서 이전 연결 이력도 선택할 수 있습니다.
- JSON 가져오기에서는 과거 파일 간 순서가 불명확하므로 변경 이벤트를 추정하지 않고 원본 스냅샷과 릴리즈 사실을 보존합니다.

## 기존 JSON 가져오기

실제 파일은 저장소에 포함하지 말고 안전한 위치에 보관하세요. 관리자 UUID는 Supabase Auth 사용자 ID입니다. 첫 파일은 현재 `apps.json`, 이후 파일은 백업입니다.

```bash
npm run import:json -- <관리자-UUID> /secure/apps.json /secure/apps.json.bak
```

- 최상위 배열 또는 `{ "apps": [...] }`를 지원합니다.
- 중첩 `appStore` / `playStore`를 우선하며 App Store legacy 최상위 레코드도 지원합니다.
- `recordId`/`id`로 경쟁사를 식별하고, 없으면 플랫폼·스토어 ID·국가 조합을 사용합니다.
- `refreshedAt`이 없거나 잘못된 레코드는 파일 전체를 롤백하며 임의 시각을 만들지 않습니다.
- 현재 파일의 이름·구분·순서를 유지합니다. 백업에만 존재하는 경쟁사는 보관 상태로 가져옵니다.
- 파일 해시/레코드/수집 대상별 작업 키로 같은 파일의 재실행을 중복 처리하지 않습니다.
- 명령은 원본 파일을 읽기만 하며 삭제하거나 수정하지 않습니다.

실제 레거시 소스/JSON이 미제공 상태이므로 먼저 사본으로 실행해 경쟁사·플랫폼·릴리즈 개수와 정렬을 원본에 대조해야 합니다. 기존 파일의 필드가 다르면 `lib/importer.js` 매핑을 조정해야 할 수 있습니다. 이전 중에는 Worker를 중지해 현재 데이터와 혼합 수집하지 않도록 하세요.

## 검증

```bash
npm test
npm run build
npm run test:browser
npm audit --omit=dev
```

- `npm test`: PGlite의 실제 PostgreSQL SQL 실행을 이용하는 단위·통합 테스트. 실제 Supabase 서비스에 연결하지 않습니다.
- `test:browser`: Chromium에서 PC/모바일 카드, 비활성 카드, 키보드 이동, 등록·수집·이력·내보내기·수정·보관을 검증합니다. 테스트에 한해 임시 DB와 주입된 사용자/스토어 결과를 사용합니다. 운영 서버에 테스트 인증 경로는 없습니다.
- Chromium 경로는 기본 `/usr/bin/chromium`이며 `CHROMIUM_PATH`로 지정할 수 있습니다. 없으면 `npx playwright-core install chromium`으로 설치할 수 있습니다.
- 스크린샷/내보내기 검증 파일은 Git에서 제외된 `test-results/`에 생성됩니다.

## 현재 검증 범위 및 제한

- 빌드, 로컬 SQL 테스트, 브라우저 테스트는 현재 환경에서 실행합니다. 최종 실행 결과는 `docs/verification.md`에 기록합니다.
- Supabase/Vercel 자격증명이 제공되지 않아 **실제 로그인, 운영 DB 적용, 공개 배포, 예약 실행, 운영 DB 백업 복구는 미검증**입니다.
- 현재 클라우드 네트워크에서 `itunes.apple.com`, `apps.apple.com`, `play.google.com` 접근이 프록시 HTTP 403으로 차단되었습니다. 실제 스토어 수집 smoke test는 배포 환경에서 반드시 실행해야 합니다. 허용목록을 관리한다면 이 도메인들을 기존 허용목록에 추가하세요.
- Apple 버전 기록과 Google Play 데이터는 외부 HTML 구조에 의존합니다. 파서 실패를 부분 성공/실패로 표시하고 기존 기록을 보존합니다.
- 앱별 시계열은 현재 표로 제공합니다. 차트와 변경 알림은 구현하지 않았습니다.
- 초기 내보내기는 50,000행 제한입니다. 큰 범위는 기간을 나누어 추출하세요.
- 플랫폼 요금, Worker 비용, Supabase 백업/PITR 보존 기간은 사용자가 선택한 플랜에 따라 다릅니다.

## 백업·복구 운영

Supabase의 백업 또는 PITR 기능을 사용 중인 요금제에서 확인하고 복구 보존 기간을 정하세요. 운영 전 스테이징 복구 절차:

1. Worker를 중지하고 복구 기준 시점을 기록합니다.
2. Supabase의 공식 복구 기능으로 별도 프로젝트에 복원합니다.
3. 경쟁사·스냅샷·릴리즈 개수와 알려진 과거 릴리즈/개정 내용을 확인합니다.
4. 복원 프로젝트에 앱을 연결하여 로그인·조회·내보내기를 검증합니다.
5. 중단된 작업의 lease 회수 및 중복 없는 수집을 확인한 후 Worker를 다시 시작합니다.

백업 기능이 켜졌다는 이유만으로 복구 검증이 완료된 것으로 간주하지 않습니다. 외부 스토어 이용 약관과 허용 요청 빈도도 운영 전에 확인하세요.

## 주요 파일

| 경로 | 역할 |
| --- | --- |
| `web/` | 카드 포털, 분석 대시보드, 로그인 및 이력 UI |
| `lib/http.js`, `api/handler.js` | API 라우팅 및 Vercel 진입점 |
| `lib/auth.js` | 관리자 인증, 쿠키, 요청 출처 검증 |
| `lib/stores.js` | 스토어 URL 검증과 데이터 수집 |
| `lib/queue.js` | 작업 큐, 잠금, 재시도, 스케줄 |
| `lib/history.js` | 스냅샷·릴리즈·설명 개정 저장 |
| `lib/importer.js` | 기존 JSON 데이터 이전 |
| `lib/export.js` | 다섯 형식의 내보내기 |
| `supabase/migrations/20261020000000_initial.sql` | PostgreSQL 스키마 |
| `scripts/worker.js` | 별도 장기 실행 Worker |
| `docs/competitor-analyzer-plan.md` | 초기 범위와 보존 원칙 |
