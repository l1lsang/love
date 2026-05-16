# Love Letters

연인끼리 로그인해서 편지를 보내고, 받은 편지와 보낸 편지를 Firebase에 저장해 다시 열어보는 작은 편지함 앱입니다.

## Firebase 설정

1. Firebase Console에서 Authentication > Sign-in method로 이동해 Email/Password 로그인을 켭니다.
2. Firestore Database를 생성합니다.
3. `firestore.rules` 내용을 Firebase Console의 Firestore Rules에 붙여 넣고 게시합니다.
4. Kakao Developers에서 앱을 만들고 카카오 로그인을 활성화합니다.
5. Kakao Developers의 Redirect URI에 로컬/배포 주소를 등록합니다. 예: `http://localhost:5173/`
6. `.env.example`을 참고해 `.env`에 `VITE_KAKAO_REST_API_KEY`와 `VITE_KAKAO_REDIRECT_URI`를 넣습니다.
7. `functions/.env.example`을 참고해 `functions/.env`에 `KAKAO_REST_API_KEY`를 넣습니다.
8. Functions를 배포한 뒤 실행합니다.

```bash
npm install
npm --prefix functions install
firebase deploy --only functions,firestore:rules
npm run dev
```

Firebase 설정값은 `src/firebase.ts`에 기본값으로 들어 있습니다. 배포용으로 분리하려면 `.env`에 `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`를 넣으면 됩니다.

카카오 로그인은 OAuth 인가 코드를 Firebase Function `kakaoLogin`에 보내고, Function이 카카오 REST API로 토큰과 사용자 정보를 확인한 뒤 Firebase custom token을 발급하는 방식입니다. 이 편지함은 이메일로 편지를 라우팅하므로 Kakao Developers 동의항목에서 `account_email`을 받을 수 있게 설정해야 합니다.

## Functions 배포 권한 오류

`Could not build the function due to a missing permission on the build service account`가 나오면 Google Cloud Console > IAM에서 아래 서비스 계정에 `Cloud Build Service Account` 역할을 추가합니다.

```text
981486847922-compute@developer.gserviceaccount.com
roles/cloudbuild.builds.builder
```

그다음 다시 배포합니다.

```bash
firebase deploy --only functions --project mydbtest-89a84 --force
```
