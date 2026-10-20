# 현재 프로젝트 연결 설정

사용자가 제공한 대상:

- Supabase: `https://zuevthrtxhmvkcbxkakc.supabase.co`
- Supabase 프로젝트 ref: `zuevthrtxhmvkcbxkakc`
- Vercel: `https://automation-of-repetitive-tasks.vercel.app`
- GitHub: `hyosuk121/-Automation-of-repetitive-tasks`, `main`

저장소 연결은 코드 배포의 출발점이다. 환경 변수, DB 스키마, 관리자 계정, Worker 실행은 별도 설정이 필요하다. 현재 런타임에서 Vercel 및 Supabase 관리 API 인증은 제공되지 않아 원격 설정을 수정하지 않았다.

## 1. Vercel 환경 변수

프로젝트 Settings → Environment Variables에서 Production에 설정한다. Preview는 별도 스테이징 Supabase를 사용하는 것을 권장한다.

| 이름 | 값 |
| --- | --- |
| `SUPABASE_URL` | `https://zuevthrtxhmvkcbxkakc.supabase.co` |
| `SUPABASE_ANON_KEY` | 사용자가 제공한 `sb_publishable_...` 키. 변수명은 ANON_KEY지만 새 publishable key도 지원 |
| `DATABASE_URL` | Supabase Connect에서 받은 PostgreSQL pooler 연결 문자열. 비밀번호 포함이므로 보안 변수로 입력 |
| `ADMIN_EMAILS` | Supabase Auth에 생성한 실제 관리자 계정 이메일 |
| `APP_ORIGIN` | `https://automation-of-repetitive-tasks.vercel.app` — 끝 슬래시 없이 설정 |
| `CRON_SECRET` | 충분히 긴 무작위 비밀값을 보안 변수로 생성·입력 |

GitHub에 키나 DB 비밀번호를 올리지 않는다. Publishable key는 서버 DB 접속 비밀번호나 service-role key를 대신하지 않는다. 이 앱은 service-role key를 요구하지 않으며, SQL은 별도의 서버용 `DATABASE_URL`로 실행한다.

변수를 저장한 후 기존 배포를 **Redeploy**해야 해당 배포에 새 값이 반영된다.

## 2. DB 마이그레이션

Supabase GitHub 연동이 인식하는 표준 위치:

```text
supabase/config.toml
supabase/migrations/20261020000000_initial.sql
```

GitHub 연결만으로 프로덕션 DB에 반드시 적용되는 것은 아니다. Supabase의 연결 브랜치, DB branching 및 production migration 설정과 실행 로그를 확인한다.

마이그레이션을 자동 적용하지 않는 구성에서는 Supabase SQL Editor에서 위 SQL 파일을 실행하거나, 안전하게 설정한 DB 연결로 다음 명령을 실행한다.

```bash
npm ci
npm run db:migrate
```

아래 테이블이 생성되었는지 확인한다:

`competitors`, `store_apps`, `collection_runs`, `collection_items`, `store_snapshots`, `release_history`, `release_note_revisions`, `change_events`, `migration_imports`, `rate_limits`.

이 저장소의 마이그레이션은 재실행할 수 있지만, 실제 프로젝트 적용 전 백업/스테이징 검증을 권장한다.

## 3. 관리자 로그인

Supabase Authentication → Users에서 관리자 계정을 생성하고 사용 가능한 이메일/비밀번호를 설정한다. 그 이메일을 Vercel의 `ADMIN_EMAILS`에 입력한다.

- 공개 회원가입은 비활성화한다.
- Supabase Auth Site URL은 Vercel 배포 주소로 설정한다.
- `supabase/config.toml`은 저장소 기반 설정이다. 이미 생성된 원격 프로젝트의 인증 설정이 파일 저장만으로 바뀌었다고 가정하지 않는다.
- 관리자 이메일이 제공되지 않아 임의의 이메일에 권한을 부여하지 않았다.
- 비밀번호는 채팅이나 저장소에 보내지 않는다.

## 4. 수집 Worker

현재 설계에서 **Vercel Cron은 작업을 큐에 넣는 역할만 한다.** 실제 스토어 요청은 별도 Worker가 수행한다.

장기 실행 Node.js 24 호스트에 이 저장소를 연결하고:

```bash
npm ci --omit=dev
npm run worker
```

Worker에는 같은 DB의 `DATABASE_URL`, 필요 시 `DATABASE_CA_FILE`, 기본 `SCHEDULE_HOUR_KST=9`를 설정한다. 웹 요청용 Supabase Auth 키는 Worker에 필요하지 않다.

Worker가 없으면 로그인·등록·조회는 가능하지만 수집 요청은 대기 상태에 남는다.

## 5. 연결 후 검증

1. `/api/health`가 `ok:true`, `configured:true`를 반환하는지 확인한다. 이 값은 설정 유무 점검이며 실제 DB 연결·로그인 성공을 보장하지 않는다.
2. 관리자 로그인 후 경쟁사를 하나 등록한다.
3. Worker가 해당 작업을 처리하고 실제 스냅샷을 저장하는지 확인한다.
4. App Store / Play Store 각각 수집하고, 부분 성공이라면 파서 경고를 확인한다.
5. 두 번째 수집 후 과거 설명과 시점별 수치가 유지되는지 확인한다.
6. 이력 내보내기, 로그아웃 후 API 접근 차단, Worker 재시작 복구를 확인한다.

## 현재 확인된 접근 제한

이 클라우드에서 Supabase와 Vercel 주소에 접근하면 외부 프록시가 HTTPS CONNECT를 `403`으로 거부한다. 서비스가 배포에 실패했거나 키가 잘못되었다는 증거는 아니다.

기존 허용목록을 유지하면서 다음 호스트 접근을 허용해야 클라우드에서 실제 연결 검증을 이어갈 수 있다:

- `zuevthrtxhmvkcbxkakc.supabase.co`
- `automation-of-repetitive-tasks.vercel.app`
- `itunes.apple.com`
- `apps.apple.com`
- `play.google.com`

DB 네트워크 접근에는 실제 `DATABASE_URL`의 pooler 호스트도 필요하다. 해당 호스트는 현재 제공되지 않았으므로 추측하지 않는다.
