# Neon 전환 구성

이 앱은 **Neon Postgres + Neon Auth + 서버리스 API**로 전환합니다. 브라우저는 HTTPS API만 호출하며 `DATABASE_URL`, 한국관광공사 키, Auth 비밀값은 서버 환경 변수에만 둡니다.

## 콘솔에서 한 번만 할 일

1. Neon Console에서 AWS 서울 리전(`ap-northeast-2`)의 `mise-personal-food-finder` 프로젝트를 만듭니다.
2. SQL Editor에서 [schema.sql](schema.sql)을 실행합니다.
3. Auth에서 Neon Auth를 켜고, 실제 배포 주소를 Trusted Domain으로 등록합니다. 이메일 매직 링크를 사용할 수 있게 설정합니다.
4. 연결 문자열은 배포 플랫폼의 `DATABASE_URL` 비밀 환경 변수에만 등록합니다. GitHub나 `dist/app-config.js`에 넣지 않습니다.

## API 계약

서버리스 API는 로그인한 Neon Auth 사용자를 검증한 뒤에만 아래 경로를 제공합니다.

- `GET /api/session`
- `POST /api/auth/magic-link`
- `POST /api/auth/sign-out`
- `POST /api/place-submissions`
- `GET /api/kto-nearby?lat=&lon=`

`place_submissions.owner_id`는 서버가 인증 세션에서 얻어 기록합니다. 브라우저가 보낸 소유자 ID를 신뢰하지 않습니다. 따라서 개인 등록 데이터는 다른 사용자에게 노출되지 않습니다.

## GitHub 기반 배포

이 저장소는 [Paulforjesus-debug/My-AI-Soul-food-search](https://github.com/Paulforjesus-debug/My-AI-Soul-food-search)에 연결돼 있습니다. Neon은 데이터베이스이므로, 모바일 공개 주소와 API 실행에는 Vercel 또는 Cloudflare Workers 같은 서버리스 호스트를 이 GitHub 저장소와 연결해야 합니다. Neon Auth와 GitHub 기반 배포를 함께 쓰기에는 Vercel 연동이 가장 간단합니다.
