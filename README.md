# Love Letters

연인끼리 로그인해서 편지를 보내고, 받은 편지와 보낸 편지를 Firebase에 저장해 다시 열어보는 작은 편지함 앱입니다.

## Firebase 설정

1. Firebase Console에서 Authentication > Sign-in method로 이동해 Email/Password 로그인을 켭니다.
2. Firestore Database를 생성합니다.
3. `firestore.rules` 내용을 Firebase Console의 Firestore Rules에 붙여 넣고 게시합니다.
4. 실행합니다.

```bash
npm install
npm run dev
```

Firebase 설정값은 `src/firebase.ts`에 기본값으로 들어 있습니다. 배포용으로 분리하려면 `.env`에 `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`를 넣으면 됩니다.
