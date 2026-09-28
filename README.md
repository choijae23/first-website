# 오일어재

주변에서 어디가 가장 싼지 궁금해서 만든 주유소 가격 비교 사이트입니다.
이름은 “어디가 제일 싸?”와 제 이름 은재의 “재”에서 따왔습니다.

👉 [사이트 사용하기](https://my-oil-website.vercel.app)

## 주요 기능
- 주소 주변 주유소 검색
- 휘발유, 경유, 고급휘발유, LPG 가격 비교
- 1·3·5km 검색 반경 선택
- 가격순·거리순 정렬과 최저가 표시

## 사용한 기술
HTML, CSS, JavaScript, Node.js, 카카오 Local API, 오피넷 API, Vercel

## 파일 구성
- public/index.html: 화면 구조
- public/styles.css: 화면 디자인
- public/app.js: 검색 요청과 결과 표시
- server.js: 주소 변환과 실제 주유소 데이터 조회
- test/server.test.js: 검색 및 오류 처리 테스트

## 실행 방법
1. Node.js 24를 설치합니다.
2. .env.example을 .env로 복사하고 카카오 REST 키와 오피넷 키를 입력합니다.
3. 터미널에서 다음 명령어를 실행합니다.

```sh
npm start
```

브라우저에서 http://127.0.0.1:3020 에 접속합니다.
Vercel에서는 두 인증키를 환경 변수로 등록합니다. .env는 깃허브에 올리지 않습니다.

가격은 원/L, 거리는 직선거리 기준입니다. 실제 판매가격은 방문 전 확인해 주세요.
