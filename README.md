# 서점 재고 관리

엑셀에서 행을 복사해 붙여넣으면 재고가 되는 웹앱입니다. 여러 대의 컴퓨터에서 같은 재고를 보도록
Postgres(Neon)에 저장하고 Vercel에 배포합니다.

> 형제 프로젝트: `../yes24-extractor` — YES24 상세페이지에서 서지정보를 뽑아 엑셀 양식으로 복사해주는
> Chrome 확장. 이 앱과 **컬럼 순서(선박 / SALES / LBI)를 공유**하지만 저장소와 배포는 완전히 별개입니다.

## 할 수 있는 것

- **엑셀 붙여넣기 입력** — 행을 복사해 붙여넣으면 열을 자동으로 알아보고 재고에 반영합니다.
  선박 양식 16열은 기본 제공되며, 다른 양식은 열을 직접 지정한 뒤 이름을 붙여 저장해 둘 수 있습니다.
- **중복 없는 누적** — 같은 책은 ISBN(없으면 도서명+저자)으로 알아보고 수량을 더합니다.
  "수량 더하기 / 덮어쓰기 / 건너뛰기" 중에 고를 수 있습니다.
- **수량 증감** — 표에서 ＋/− 버튼이나 숫자 직접 입력. 여러 권 선택 후 일괄 입고/출고도 됩니다.
- **검색** — 도서명 · ISBN · 저자 · 출판사 · 분류 · 메모. `Ctrl+K` 로 검색창 이동.
- **부족/품절 표시** — 기준 수량 이하는 주황, 0권은 빨강으로 강조.
- **입출고 이력** — 수량이 바뀔 때마다 언제 몇 권이 왜 바뀌었는지 남습니다.
- **내보내기** — CSV, 그리고 선박 / SALES / LBI 양식으로 클립보드 복사 (엑셀에 바로 붙여넣기).

## 처음 세팅

### 1. DB 만들기 (Neon)

[console.neon.tech](https://console.neon.tech) 에서 프로젝트를 만들고 연결 문자열을 복사합니다.
(무료 플랜으로 충분합니다.)

### 2. 환경변수

```bash
cp .env.example .env.local
```

`.env.local` 을 열어 세 값을 채웁니다.

| 이름 | 설명 |
|---|---|
| `DATABASE_URL` | Neon 연결 문자열 |
| `APP_PASSWORD` | 재고 페이지 접속용 공용 비밀번호 (직원들과 공유할 값) |
| `AUTH_SECRET` | 쿠키 서명용 임의 문자열 |

`AUTH_SECRET` 생성:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. 테이블 만들기

```bash
npm install
npm run db:push      # 스키마를 DB에 그대로 반영 (초기 세팅용)
```

### 4. 실행

```bash
npm run dev          # http://localhost:3000
```

## Vercel 배포

1. 이 폴더를 GitHub 저장소로 올립니다.
2. [vercel.com/new](https://vercel.com/new) 에서 그 저장소를 import 합니다.
3. **Settings → Environment Variables** 에 `APP_PASSWORD` 와 `AUTH_SECRET` 을 넣습니다.
4. **Storage → Create Database → Neon** 으로 DB를 연결하면 `DATABASE_URL` 이 자동으로 주입됩니다.
   (이미 만든 Neon 프로젝트를 쓰려면 `DATABASE_URL` 을 환경변수로 직접 넣어도 됩니다.)
5. 배포 후 한 번만 로컬에서 `npm run db:push` 를 프로덕션 `DATABASE_URL` 로 실행해 테이블을 만듭니다.

이후에는 `git push` 하면 자동으로 다시 배포됩니다.

## 명령어

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm test` | 엑셀 파서 테스트 (실제 선박 엑셀 데이터로 검증) |
| `npm run db:push` | 스키마를 DB에 반영 |
| `npm run db:generate` | 스키마 변경분을 SQL 마이그레이션으로 생성 |
| `npm run db:studio` | 브라우저에서 DB 내용 확인 |

## 구조

```
app/
├── page.tsx                재고 화면 (InventoryApp 을 띄우기만 함)
├── login/page.tsx          비밀번호 입력 화면
├── components/
│   ├── InventoryApp.tsx    목록 · 검색 · 수량 증감 · 일괄 처리
│   ├── ImportDialog.tsx    엑셀 붙여넣기 → 열 지정 → 미리보기 → 반영
│   ├── EditDialog.tsx      직접 추가 / 수정
│   ├── LogDialog.tsx       입출고 이력
│   └── ui.tsx              버튼 · 모달 · 입력
└── api/
    ├── books/              목록·검색·추가·일괄처리 (+ [id] 수정/삭제, /match, /[id]/logs)
    ├── import/             엑셀 일괄 반영 (UPSERT)
    ├── presets/            사용자 저장 양식
    └── login, logout

lib/
├── schema.ts               books / stock_logs / import_presets
├── db.ts                   Drizzle + Neon (지연 초기화)
├── parse.ts                엑셀 파싱 · 열 자동 감지 · 중복 판정  ← 핵심
├── format.ts               선박/SALES/LBI 양식, CSV
├── auth.ts                 공용 비밀번호 + HMAC 쿠키
└── api.ts                  라우트 공통 헬퍼

middleware.ts               로그인 안 했으면 /login 으로 (API 는 401)
tests/parse.test.mjs        파서 검증
```

## 알아둘 점

### 같은 책 판정 (`matchKey`)

`books.match_key` 컬럼이 UNIQUE 이고, 엑셀 반영은 이 컬럼 기준 UPSERT 입니다.

- ISBN 이 있으면 → `i:9791130681887` (하이픈·공백 무시)
- 없으면 → `t:도서명|저자` (공백 제거, 소문자)

선박 엑셀에서 ISBN 자리에 `판매용` 같은 값이 들어오면 그 문자열은 그대로 보존하되,
식별은 도서명+저자로 합니다.

### 선박 양식 열 순서

엑셀 A열이 `TOTAL`, B열부터가 Chrome 확장이 복사해주는 값입니다.

```
TOTAL │ ISBN │ 제목 │ Unit Price │ 15% DC │ After DC │ Copies │ Amount │
Author │ Pub.Date │ (빈칸) │ Publisher │ Subject │ TOTAL │ KRW │ Weight
```

수량은 `Copies`(항상 1)가 아니라 **`TOTAL`(1열)** 에서 가져옵니다.

### 붙여넣기는 탭으로

엑셀에서 복사하면 셀 구분이 탭이라 빈 열까지 정확히 살아납니다.
채팅이나 메모장을 거치면 탭이 공백으로 바뀌어 **빈 열이 사라집니다** —
그럴 땐 붙여넣기 화면의 열 지정 표에서 직접 맞춰 주세요.
