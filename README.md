# mise — 개인 맛집 탐색기

국내외에서 사용할 개인용 맛집 탐색 도구입니다. 장소를 단순히 나열하지 않고, 데이터 출처와 마지막 확인 시점을 함께 보여 주어 검색 결과를 판단할 수 있게 만듭니다.

## 선정한 설계

**공공·오픈데이터 중심 하이브리드**를 사용합니다.

1. 한국: 공공데이터포털 일반음식점 인허가 데이터로 영업 상태를 확인하고, 카카오 로컬 검색으로 주변 장소를 보강합니다.
2. 해외: OpenStreetMap/Overpass를 기본 POI 데이터로 사용합니다.
3. 선택 보강: Google Places와 YouTube는 사용자가 특정 장소의 상세·영상 정보를 열 때만 호출합니다. 이 데이터는 별도 출처로 표시하고 저장 정책을 준수합니다.
4. 신뢰도: `공식 인허가/운영 상태`, `복수 출처 일치`, `좌표·주소 일치`, `확인 시점`을 점수로 합산합니다. AI는 자연어 취향을 필터로 바꾸고 추천 이유를 설명할 뿐, 후기나 점수를 지어내지 않습니다.

현재 버전에서는 **현재 위치 사용 → 탐색하기**를 누르면 한국관광공사, 적용 가능한 지역 공공데이터, OpenStreetMap을 함께 확인합니다. 대구에서는 대구광역시 대구푸드 공식 맛집 데이터가 자동으로 추가되며, 이름·주소 또는 근접 좌표가 일치하는 결과는 하나로 합쳐 복수 출처 신뢰도를 높입니다. 요청은 사용자 동작 때만 발생하며 10초의 재검색 간격을 둡니다. 공개 OSM 인스턴스는 개인·저빈도 사용에 적합합니다.

## 모바일·개인 등록 환경

- `dist/manifest.webmanifest`와 `dist/sw.js`를 포함해 휴대폰 브라우저에서 **홈 화면에 설치**할 수 있는 PWA로 구성했습니다. 오프라인에서는 화면 껍데기와 기존 기기 내 즐겨찾기만 보존되며, 실시간 위치·맛집 검색은 인터넷 연결이 필요합니다.
- `맛집 등록`은 Neon Auth 이메일·비밀번호 로그인 후 동작합니다. 등록은 기본적으로 `pending`(검토 대기) 상태이며, API가 로그인 토큰을 확인해 등록자 본인 데이터만 읽도록 제한합니다.
- Neon Postgres와 Neon Auth를 사용합니다. 브라우저에는 HTTPS API 주소만 설정하고, `DATABASE_URL`, `KTO_SERVICE_KEY` 등 비밀값은 절대 넣지 않습니다.
- [migrations/0001_create_place_submissions.sql](migrations/0001_create_place_submissions.sql)이 맛집 등록 테이블의 버전 관리된 원본입니다. 서버 API는 로그인 사용자를 검증한 뒤에만 등록을 허용합니다.

## 개인정보와 키 관리

- 즐겨찾기는 현재 브라우저의 `localStorage`에만 저장됩니다.
- 위치는 사용자가 현재 위치 사용을 누르고 권한을 허용한 순간에만 읽습니다.
- API 키는 절대 브라우저 코드나 Git에 넣지 않습니다. `.env.example`을 `.env.local`로 복사해 개인 키를 설정합니다.
- `dist/app-config.js`에는 배포된 HTTPS API 주소만 넣습니다. 비밀 키는 Neon/서버리스 호스트의 환경 변수에만 설정합니다.

## 공공·지역 데이터 연결 현황

1. **한국관광공사 TourAPI:** 연결을 완료했습니다. 현재 위치 검색 시 관광공사 음식점과 OSM 결과가 함께 표시됩니다. 일반 인증키는 URL 인코딩된 형태 그대로 `.env.local`의 `KTO_SERVICE_KEY`에 보관하며, 서버가 요청을 만들 때 한 번만 해석합니다. 키는 브라우저나 Git에 노출되지 않습니다.
2. **대구광역시 대구푸드:** 연결을 완료했습니다. 현재 공식 맛집 906곳을 구·군별로 동기화했습니다. 대구 좌표에서는 가까운 구·군 목록을 자동으로 적용합니다. 원본 서버가 외부 클라우드 호출을 제한해 앱 배포 시 스냅샷을 갱신하는 안정적 방식으로 구성했으며, GitHub Actions가 매일 자동 갱신합니다. 이 API는 음식점 좌표를 제공하지 않으므로 거리 계산은 관광공사·OSM 좌표를 사용하고, 지역 공식 목록은 선정 근거와 상세 설명을 보강합니다.
3. **전국 일반음식점 인허가:** 공공데이터포털의 `전국일반음식점표준데이터` CSV를 개인 PC의 `private-data/food-permits.csv`에 저장한 뒤 아래 명령으로 영업·정상 업소만 정제합니다.

   ```powershell
   node scripts/build-korea-permit-index.mjs private-data/food-permits.csv private-data/korea-permits.json
   ```

   원본과 정제본은 Git에서 제외됩니다. 이 인덱스는 인허가 상태 검증용이며, 실시간 카카오 로컬·관광공사 결과와 이름·주소를 비교해 신뢰도를 보강하는 다음 단계에 사용합니다.
4. 서울·경기 등 다른 지자체 자료는 같은 지역 어댑터 형식으로 추가합니다. 각 API의 승인·키·좌표 제공 여부를 확인한 뒤 공식 선정 데이터만 추천 근거로 사용합니다.
5. 해외는 요청량에 맞는 OSM 제공자 또는 자체 호스팅 지오코딩을 연결합니다. 공용 Nominatim은 자동완성에 사용하지 않습니다.
6. 필요할 때만 Google Places·YouTube 조회를 붙이며, 해당 응답은 제공자 정책에 맞게 표시합니다.

대구시 자료를 수동으로 즉시 갱신하려면 다음 명령을 실행합니다.

```powershell
node scripts/sync-daegu-data.mjs
```

## 로컬 실행

```powershell
node scripts/private-data-server.mjs
```

브라우저에서 `http://127.0.0.1:4173`을 엽니다. API 키 없이도 기본 탐색과 OSM 검색은 사용할 수 있으며, 한국관광공사 보강은 `KTO_SERVICE_KEY`가 있을 때만 로컬 서버에서 작동합니다.

## 언제 어디서나 쓰기 위한 배포 순서

1. Neon 운영 브랜치에 Auth, 보호된 `miseapi` Function, 등록 테이블 마이그레이션을 배포했습니다.
2. `https://paulforjesus-debug.github.io`를 Neon Auth Trusted Domain으로 등록했습니다.
3. GitHub Actions가 `main` 브랜치의 `dist` 폴더를 GitHub Pages로 배포하도록 구성했습니다. 저장소 소유자가 GitHub **Settings → Pages → Build and deployment → Source: GitHub Actions**를 한 번 활성화하면 `https://paulforjesus-debug.github.io/My-AI-Soul-food-search/`에서 열 수 있습니다.
4. 휴대폰에서 해당 주소를 열어 “홈 화면에 추가”를 선택합니다.

`KTO_SERVICE_KEY`는 Neon Function의 서버 비밀값으로 배포되어 있습니다. 인증키를 교체할 때에는 `.env.local` 값만 바꾼 뒤 `neon deploy --env .env.local`로 다시 배포합니다.

## 버전 관리

이 프로젝트는 Git 저장소로 초기화되어 있습니다. 초기 화면을 첫 커밋으로 기록한 뒤, 데이터 제공자 연결과 신뢰도 계산을 기능 단위로 커밋합니다. 원격 GitHub 저장소 주소를 정하면 `origin`을 연결해 푸시할 수 있습니다.
