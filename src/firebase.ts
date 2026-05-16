import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFunctions } from 'firebase/functions'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ??
    'AIzaSyDBqpnbeRMaBUuL4Hd3i5Vz2G5ZTHU7akE',
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'mydbtest-89a84.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'mydbtest-89a84',
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ??
    'mydbtest-89a84.firebasestorage.app',
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '981486847922',
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ??
    '1:981486847922:web:280677cb53ce1b579986ab',
}

export const firebaseApp = initializeApp(firebaseConfig)
export const auth = getAuth(firebaseApp)
export const db = getFirestore(firebaseApp)
export const storage = getStorage(firebaseApp)
export const functions = getFunctions(
  firebaseApp,
  import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION ?? 'us-central1',
)
