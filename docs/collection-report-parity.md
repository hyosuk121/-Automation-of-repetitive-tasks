# 로컬 HTML 보고서와 수집 항목 비교

제공된 `store-version-dashboard (0623).html`, `(0709).html`을 데이터 예시로 확인했다. 각각 App Store 최신 행 12개, Play Store 최신 행 12개, App Store 버전 이력 249개(12개 앱)를 포함한다. 보고서 자체는 스토어 원본 HTML이 아니므로 그 구조를 Apple 파서의 원본 응답으로 사용하지 않는다.

| 보고서 항목 | 수집/저장 필드 | 화면 |
| --- | --- | --- |
| 앱 이름, 아이콘 | appName, iconUrl | 경쟁사 / 앱 이름 |
| 평점, 평점 수 | rating, ratingCount | App Store 평점 / 평점 수 |
| 평점, 리뷰 수 | rating, reviewCount | Play Store 평점 / 리뷰 수 |
| 다운로드 구간 | downloadsText | Play Store 다운로드 |
| 최신 업데이트 일자 | sourceUpdatedAt | 최신 업데이트 |
| 최신 버전 | version | 최신 버전, 미제공 시 알 수 없음 |
| 최신 버전 내용 | latestNotes | 업데이트 내용 보기 (전체 설명 펼치기) |
| App Store 과거 버전, 일자, 내용 | releases 및 release_note_revisions | 앱 이름 클릭 → 릴리즈 이력 |

Apple 수집은 Lookup 기본 정보와 스토어의 버전 기록을 조합한다. 기존 JSON 외에 중첩 JSON 문자열인 shoebox 캐시, `versionHistory.items`, `.version-history__item` HTML 목록을 처리한다. 문단/줄바꿈은 보존한다. 공식 원본과 같은 origin의 리디렉션만 최대 3회 허용하며 전체 요청 시간 제한과 TLS 검증을 유지한다. 파싱이 불완전하면 최신 정보만 저장하고 이전 이력을 삭제/미노출 처리하지 않는다.

Play Store의 `VARY` 등 미제공 버전은 추측하지 않는다. 명시된 버전은 저장한다. 평점 수와 리뷰 수를 서로 구분하고 설명의 HTML 줄바꿈을 텍스트로 변환한다.

아이콘은 저장된 `icon_url`을 표시한다. 외부 HTTPS 이미지만 허용하며 누락/로딩 실패 시 경쟁사명 첫 글자를 표시한다. 기존 스냅샷에 아이콘이 저장되어 있다면 재수집 없이도 표시된다.

## 검증 범위와 제한

- 30개 테스트 통과. 파서 fixture로 JSON/DOM/리디렉션/미제공 값/줄바꿈을 검증했다.
- 브라우저에서 실제 SQL 저장 후 아이콘과 평점 수, 업데이트 설명 표시 및 이미지 오류 대체 표시를 검증한다.
- 개발 환경 프록시가 apps.apple.com 연결을 403으로 거부하여 실시간 스토어 응답은 확인하지 못했다. 테스트 fixture를 실제 Apple 응답 캡처로 취급하지 않는다.
- 보고서에 있던 249개 과거 기록이 지금도 스토어에 모두 공개되어 있다는 보장은 없다. 이번 작업은 수집기 개선이며 첨부 파일을 운영 DB에 가져오는 작업은 수행하지 않았다. 현재 미공개 과거 기록을 복구하려면 별도의 보고서 가져오기가 필요하다.
