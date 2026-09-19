# mise — 개인 맛집 탐색기

국내외에서 사용할 개인용 맛집 탐색 도구입니다. 장소를 단순히 나열하지 않고, 데이터 출처와 마지막 확인 시점을 함께 보여 주어 검색 결과를 판단할 수 있게 만듭니다.

## 선정한 설계

**공공·오픈데이터 중심 하이브리드**를 사용합니다.

1. 한국: 공공데이터포털 일반음식점 인허가 데이터로 영업 상태를 확인하고, 카카오 로컬 검색으로 주변 장소를 보강합니다.
2. 해외: OpenStreetMap/Overpass를 기본 POI 데이터로 사용합니다.
3. 선택 보강: Google Places와 YouTube는 사용자가 특정 장소의 상세·영상 정보를 열 때만 호출합니다. 이 데이터는 별도 출처로 표시하고 저장 정책을 준수합니다.
4. 신뢰도: `공식 인허가/운영 상태`, `복수 출처 일치`, `좌표·주소 일치`, `확인 시점`을 점수로 합산합니다. AI는 자연어 취향을 필터로 바꾸고 추천 이유를 설명할 뿐, 후기나 점수를 지어내지 않습니다.

현재 버전에서는 **현재 위치 사용 → 탐색하기**를 누르면 OpenStreetMap의 주변 음식점 정보를 실시간으로 불러옵니다. 요청은 사용자 동작 때만 발생하며 10초의 재검색 간격을 둡니다. 공개 OSM 인스턴스는 개인·저빈도 사용에 적합합니다.

## 모바일·개인 등록 환경

- `dist/manifest.webmanifest`와 `dist/sw.js`를 포함해 휴대폰 브라우저에서 **홈 화면에 설치**할 수 있는 PWA로 구성했습니다. 오프라인에서는 화면 껍데기와 기존 기기 내 즐겨찾기만 보존되며, 실시간 위치·맛집 검색은 인터넷 연결이 필요합니다.
- `맛집 등록`은 이메일 매직 링크 로그인 후 동작합니다. 등록은 기본적으로 `pending`(검토 대기) 상태이며, 등록자 본인만 읽거나 수정할 수 있습니다.
- `supabase/schema.sql`에는 RLS 정책을 포함했습니다. 브라우저에는 공개 가능한 Supabase publishable key만 설정하고, `service_role`, `KTO_SERVICE_KEY` 등 비밀 키는 절대 넣지 않습니다.
- `supabase/functions/kto-nearby/`는 관광공사 키를 서버 함수의 비밀값으로 보관하는 모바일용 경로입니다. 배포 도메인(`WEB_ORIGIN`)과 로그인 사용자를 검사한 뒤에만 호출합니다.

## 개인정보와 키 관리

- 즐겨찾기는 현재 브라우저의 `localStorage`에만 저장됩니다.
- 위치는 사용자가 현재 위치 사용을 누르고 권한을 허용한 순간에만 읽습니다.
- API 키는 절대 브라우저 코드나 Git에 넣지 않습니다. `.env.example`을 `.env.local`로 복사해 개인 키를 설정합니다.
- `dist/app-config.js`에는 Supabase URL과 publishable key만 넣습니다. 비밀 키는 Supabase 환경 변수에만 설정합니다.

## 다음 데이터 연결 단계

1. **한국관광공사 TourAPI:** `.env.example`을 `.env.local`로 복사해 공공데이터포털의 `KTO_SERVICE_KEY`를 넣고 `node scripts/private-data-server.mjs`를 실행합니다. 현재 위치 검색 시 관광공사 음식점과 OSM 결과가 함께 표시됩니다. 키는 브라우저나 Git에 노출되지 않습니다.
2. **전국 일반음식점 인허가:** 공공데이터포털의 `전국일반음식점표준데이터` CSV를 개인 PC의 `private-data/food-permits.csv`에 저장한 뒤 아래 명령으로 영업·정상 업소만 정제합니다.

   ```powershell
   node scripts/build-korea-permit-index.mjs private-data/food-permits.csv private-data/korea-permits.json
   ```

   원본과 정제본은 Git에서 제외됩니다. 이 인덱스는 인허가 상태 검증용이며, 실시간 카카오 로컬·관광공사 결과와 이름·주소를 비교해 신뢰도를 보강하는 다음 단계에 사용합니다.
3. `KAKAO_REST_API_KEY`로 국내 반경/키워드 검색을 연결합니다.
4. 해외는 요청량에 맞는 OSM 제공자 또는 자체 호스팅 지오코딩을 연결합니다. 공용 Nominatim은 자동완성에 사용하지 않습니다.
5. 필요할 때만 Google Places·YouTube 조회를 붙이며, 해당 응답은 제공자 정책에 맞게 표시합니다.

## 로컬 실행

```powershell
node scripts/private-data-server.mjs
```

브라우저에서 `http://127.0.0.1:4173`을 엽니다. API 키 없이도 기본 탐색과 OSM 검색은 사용할 수 있으며, 한국관광공사 보강은 `KTO_SERVICE_KEY`가 있을 때만 로컬 서버에서 작동합니다.

## 언제 어디서나 쓰기 위한 배포 순서

1. 전용 Supabase 프로젝트를 만들고 `supabase/schema.sql`을 마이그레이션으로 적용합니다.
2. Supabase Auth의 이메일 로그인과 허용 리디렉션 URL에 실제 HTTPS 주소를 등록합니다.
3. `KTO_SERVICE_KEY`, `WEB_ORIGIN`을 서버 비밀값으로 설정하고 `kto-nearby` 함수를 배포합니다.
4. `dist/app-config.js`에 URL과 publishable key만 입력한 뒤, HTTPS 정적 호스팅(GitHub Pages, Cloudflare Pages 등)에 `dist`를 배포합니다.
5. 휴대폰에서 해당 주소를 열어 “홈 화면에 추가”를 선택합니다.

정적 호스팅 주소는 아직 연결하지 않았습니다. 현재 작업 환경에서 Sites 배포 기능이 활성화되어 있지 않아, GitHub 원격 저장소 또는 사용 중인 호스팅 계정 연결이 필요합니다.

## 버전 관리

이 프로젝트는 Git 저장소로 초기화되어 있습니다. 초기 화면을 첫 커밋으로 기록한 뒤, 데이터 제공자 연결과 신뢰도 계산을 기능 단위로 커밋합니다. 원격 GitHub 저장소 주소를 정하면 `origin`을 연결해 푸시할 수 있습니다.
