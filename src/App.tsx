import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth'
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { auth, db, functions, storage } from './firebase'
import './App.css'

type AuthMode = 'signIn' | 'signUp'
type MailboxTab = 'received' | 'sent'

type AuthForm = {
  name: string
  email: string
  password: string
}

type ComposeForm = {
  recipientEmail: string
  recipientName: string
  title: string
  message: string
  sharedDate: string
  memoryPlace: string
}

type LetterData = {
  title?: string
  message?: string
  recipientEmail?: string
  recipientName?: string
  senderUid?: string
  senderEmail?: string
  senderName?: string
  sharedDate?: string
  memoryPlace?: string
  photoUrl?: string
  photoPath?: string
  createdAt?: Timestamp | null
  readAt?: Timestamp | null
}

type Letter = {
  id: string
  title: string
  message: string
  recipientEmail: string
  recipientName: string
  senderUid: string
  senderEmail: string
  senderName: string
  sharedDate: string
  memoryPlace: string
  photoUrl: string
  photoPath: string
  createdAt: Timestamp | null
  readAt: Timestamp | null
}

type KakaoLoginResult = {
  customToken: string
  profile?: {
    displayName?: string
    photoURL?: string
    email?: string
  }
}

type KakaoAuthUrlResult = {
  authUrl: string
}

const emptyAuthForm: AuthForm = {
  name: '',
  email: '',
  password: '',
}

const emptyComposeForm: ComposeForm = {
  recipientEmail: '',
  recipientName: '',
  title: '오늘 너에게 남기는 마음',
  message:
    '오늘 문득 네 생각이 났어.\n별일 아닌 하루도 너에게 닿으면 조금 더 다정해지는 것 같아.',
  sharedDate: '',
  memoryPlace: '',
}

const lettersRef = collection(db, 'letters')
const kakaoLogin = httpsCallable<
  { code: string; redirectUri: string },
  KakaoLoginResult
>(functions, 'kakaoLogin')
const createKakaoAuthUrl = httpsCallable<
  { redirectUri: string; state: string },
  KakaoAuthUrlResult
>(functions, 'createKakaoAuthUrl')
const KAKAO_STATE_KEY = 'love-kakao-oauth-state'
const MAX_PHOTO_SIZE = 8 * 1024 * 1024

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function getKakaoRedirectUri() {
  return (
    import.meta.env.VITE_KAKAO_REDIRECT_URI ??
    `${window.location.origin}${window.location.pathname}`
  )
}

function cleanKakaoQuery() {
  const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`
  window.history.replaceState({}, document.title, cleanUrl)
}

function displayNameFor(user: User) {
  return user.displayName || user.email?.split('@')[0] || '나'
}

function mailboxAddressFor(user: User) {
  return normalizeEmail(user.email ?? '')
}

function toLetter(snapshot: QueryDocumentSnapshot): Letter {
  const data = snapshot.data() as LetterData

  return {
    id: snapshot.id,
    title: data.title ?? '제목 없는 편지',
    message: data.message ?? '',
    recipientEmail: data.recipientEmail ?? '',
    recipientName: data.recipientName ?? '',
    senderUid: data.senderUid ?? '',
    senderEmail: data.senderEmail ?? '',
    senderName: data.senderName ?? '익명의 마음',
    sharedDate: data.sharedDate ?? '',
    memoryPlace: data.memoryPlace ?? '',
    photoUrl: data.photoUrl ?? '',
    photoPath: data.photoPath ?? '',
    createdAt: data.createdAt ?? null,
    readAt: data.readAt ?? null,
  }
}

function sortLetters(letters: Letter[]) {
  return [...letters].sort(
    (left, right) =>
      (right.createdAt?.toMillis() ?? 0) - (left.createdAt?.toMillis() ?? 0),
  )
}

function formatDate(value: Timestamp | null) {
  if (!value) {
    return '방금 전'
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value.toDate())
}

function friendlyError(error: unknown) {
  const code = (error as { code?: string }).code

  switch (code) {
    case 'auth/email-already-in-use':
      return '이미 가입된 이메일이에요. 로그인으로 들어와 주세요.'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return '이메일이나 비밀번호를 다시 확인해 주세요.'
    case 'auth/weak-password':
      return '비밀번호는 6자 이상으로 정해 주세요.'
    case 'permission-denied':
      return 'Firebase 권한 설정이 막혀 있어요. Firestore 규칙을 확인해 주세요.'
    case 'storage/unauthorized':
      return '사진 업로드 권한이 막혀 있어요. Storage 규칙을 확인해 주세요.'
    case 'storage/quota-exceeded':
      return 'Storage 사용량이 가득 찼어요. Firebase 저장공간을 확인해 주세요.'
    case 'functions/failed-precondition':
      return '카카오 서버 설정을 확인해 주세요.'
    case 'functions/unauthenticated':
      return '카카오 로그인 인증이 만료되었어요. 다시 시도해 주세요.'
    default:
      return error instanceof Error
        ? error.message.replace('Firebase: ', '')
        : '잠시 후 다시 시도해 주세요.'
  }
}

function App() {
  const hasHandledKakaoRedirect = useRef(false)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const photoPreviewRef = useRef('')
  const [authReady, setAuthReady] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode>('signIn')
  const [authForm, setAuthForm] = useState<AuthForm>(emptyAuthForm)
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [kakaoLoading, setKakaoLoading] = useState(false)
  const [sendLoading, setSendLoading] = useState(false)
  const [compose, setCompose] = useState<ComposeForm>(emptyComposeForm)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('')
  const [receivedLetters, setReceivedLetters] = useState<Letter[]>([])
  const [sentLetters, setSentLetters] = useState<Letter[]>([])
  const [mailboxTab, setMailboxTab] = useState<MailboxTab>('received')
  const [selectedLetterId, setSelectedLetterId] = useState('')
  const [sendStatus, setSendStatus] = useState('')
  const [mailboxError, setMailboxError] = useState('')
  const [copyStatus, setCopyStatus] = useState('')

  useEffect(() => {
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setAuthReady(true)
    })
  }, [])

  useEffect(() => {
    return () => {
      if (photoPreviewRef.current) {
        URL.revokeObjectURL(photoPreviewRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!authReady || hasHandledKakaoRedirect.current) {
      return
    }

    const searchParams = new URLSearchParams(window.location.search)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const kakaoError =
      searchParams.get('error_description') ?? searchParams.get('error')

    if (!code && !kakaoError) {
      return
    }

    hasHandledKakaoRedirect.current = true

    const finishKakaoRedirectWithError = (message: string) => {
      window.queueMicrotask(() => setAuthError(message))
      cleanKakaoQuery()
    }

    if (kakaoError) {
      finishKakaoRedirectWithError(`카카오 로그인이 취소되었어요. ${kakaoError}`)
      return
    }

    const savedState = window.localStorage.getItem(KAKAO_STATE_KEY)

    if (!state || state !== savedState) {
      finishKakaoRedirectWithError(
        '카카오 로그인 요청을 확인할 수 없어요. 다시 시도해 주세요.',
      )
      return
    }

    const exchangeKakaoCode = async () => {
      setAuthError('')
      setKakaoLoading(true)

      try {
        const result = await kakaoLogin({
          code: code ?? '',
          redirectUri: getKakaoRedirectUri(),
        })
        const credential = await signInWithCustomToken(
          auth,
          result.data.customToken,
        )
        await credential.user.reload()

        const { displayName, photoURL } = result.data.profile ?? {}

        if (displayName || photoURL) {
          await updateProfile(credential.user, {
            displayName: displayName || credential.user.displayName,
            photoURL: photoURL || credential.user.photoURL,
          })
        }

        window.localStorage.removeItem(KAKAO_STATE_KEY)
      } catch (error) {
        setAuthError(friendlyError(error))
      } finally {
        setKakaoLoading(false)
        cleanKakaoQuery()
      }
    }

    void exchangeKakaoCode()
  }, [authReady])

  useEffect(() => {
    if (!user?.email) {
      return
    }

    const userEmail = mailboxAddressFor(user)
    const receivedQuery = query(
      lettersRef,
      where('recipientEmail', '==', userEmail),
    )
    const sentQuery = query(lettersRef, where('senderUid', '==', user.uid))

    const unsubscribeReceived = onSnapshot(
      receivedQuery,
      (snapshot) => {
        setReceivedLetters(sortLetters(snapshot.docs.map(toLetter)))
        setMailboxError('')
      },
      (error) => setMailboxError(friendlyError(error)),
    )

    const unsubscribeSent = onSnapshot(
      sentQuery,
      (snapshot) => {
        setSentLetters(sortLetters(snapshot.docs.map(toLetter)))
        setMailboxError('')
      },
      (error) => setMailboxError(friendlyError(error)),
    )

    return () => {
      unsubscribeReceived()
      unsubscribeSent()
    }
  }, [user])

  const activeLetters = mailboxTab === 'received' ? receivedLetters : sentLetters
  const selectedLetter = useMemo(
    () =>
      activeLetters.find((letter) => letter.id === selectedLetterId) ??
      activeLetters[0] ??
      null,
    [activeLetters, selectedLetterId],
  )
  const unreadCount = receivedLetters.filter((letter) => !letter.readAt).length

  const updateAuthForm =
    (field: keyof AuthForm) => (event: ChangeEvent<HTMLInputElement>) => {
      setAuthForm((currentForm) => ({
        ...currentForm,
        [field]: event.target.value,
      }))
    }

  const updateCompose =
    (field: keyof ComposeForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setCompose((currentForm) => ({
        ...currentForm,
        [field]: event.target.value,
      }))
      setSendStatus('')
    }

  const handlePhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null

    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      setSendStatus('이미지 파일만 업로드할 수 있어요.')
      event.target.value = ''
      return
    }

    if (file.size > MAX_PHOTO_SIZE) {
      setSendStatus('사진은 8MB 이하로 올려 주세요.')
      event.target.value = ''
      return
    }

    if (photoPreviewRef.current) {
      URL.revokeObjectURL(photoPreviewRef.current)
    }

    const previewUrl = URL.createObjectURL(file)
    photoPreviewRef.current = previewUrl
    setPhotoPreviewUrl(previewUrl)
    setPhotoFile(file)
    setSendStatus('')
  }

  const clearPhoto = () => {
    if (photoPreviewRef.current) {
      URL.revokeObjectURL(photoPreviewRef.current)
      photoPreviewRef.current = ''
    }

    setPhotoFile(null)
    setPhotoPreviewUrl('')

    if (photoInputRef.current) {
      photoInputRef.current.value = ''
    }
  }

  const uploadLetterPhoto = async (file: File, currentUser: User) => {
    const extension = file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '')
    const fileName = `${crypto.randomUUID()}${extension ? `.${extension}` : ''}`
    const photoPath = `letter-photos/${currentUser.uid}/${fileName}`
    const photoRef = storageRef(storage, photoPath)
    const snapshot = await uploadBytes(photoRef, file, {
      contentType: file.type,
      customMetadata: {
        senderUid: currentUser.uid,
      },
    })
    const photoUrl = await getDownloadURL(snapshot.ref)

    return { photoUrl, photoPath }
  }

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthError('')
    setAuthLoading(true)

    try {
      const email = normalizeEmail(authForm.email)

      if (authMode === 'signUp') {
        const credential = await createUserWithEmailAndPassword(
          auth,
          email,
          authForm.password,
        )

        if (authForm.name.trim()) {
          await updateProfile(credential.user, {
            displayName: authForm.name.trim(),
          })
        }
      } else {
        await signInWithEmailAndPassword(auth, email, authForm.password)
      }

      setAuthForm(emptyAuthForm)
    } catch (error) {
      setAuthError(friendlyError(error))
    } finally {
      setAuthLoading(false)
    }
  }

  const startKakaoLogin = async () => {
    const state = crypto.randomUUID()
    const redirectUri = getKakaoRedirectUri()

    setAuthError('')
    setKakaoLoading(true)

    try {
      const result = await createKakaoAuthUrl({
        redirectUri,
        state,
      })

      window.localStorage.setItem(KAKAO_STATE_KEY, state)
      window.location.assign(result.data.authUrl)
    } catch (error) {
      setAuthError(friendlyError(error))
      setKakaoLoading(false)
    }
  }

  const handleSendLetter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSendStatus('')

    if (!user?.email) {
      setSendStatus('로그인 후 편지를 보낼 수 있어요.')
      return
    }

    const recipientEmail = normalizeEmail(compose.recipientEmail)
    const title = compose.title.trim()
    const message = compose.message.trim()

    if (!recipientEmail || !title || !message) {
      setSendStatus('받는 편지 주소, 제목, 내용을 채워 주세요.')
      return
    }

    setSendLoading(true)

    try {
      const uploadedPhoto = photoFile
        ? await uploadLetterPhoto(photoFile, user)
        : { photoUrl: '', photoPath: '' }

      await addDoc(lettersRef, {
        title,
        message,
        recipientEmail,
        recipientName: compose.recipientName.trim(),
        senderUid: user.uid,
        senderEmail: mailboxAddressFor(user),
        senderName: displayNameFor(user),
        sharedDate: compose.sharedDate.trim(),
        memoryPlace: compose.memoryPlace.trim(),
        photoUrl: uploadedPhoto.photoUrl,
        photoPath: uploadedPhoto.photoPath,
        createdAt: serverTimestamp(),
        readAt: null,
      })

      setCompose((currentForm) => ({
        ...emptyComposeForm,
        recipientEmail: currentForm.recipientEmail,
        recipientName: currentForm.recipientName,
      }))
      clearPhoto()
      setMailboxTab('sent')
      setSendStatus('편지가 저장되고 상대의 받은 편지함으로 보내졌어요.')
    } catch (error) {
      setSendStatus(friendlyError(error))
    } finally {
      setSendLoading(false)
    }
  }

  const openLetter = async (letter: Letter) => {
    setSelectedLetterId(letter.id)

    if (mailboxTab !== 'received' || letter.readAt) {
      return
    }

    try {
      await updateDoc(doc(db, 'letters', letter.id), {
        readAt: serverTimestamp(),
      })
    } catch (error) {
      setMailboxError(friendlyError(error))
    }
  }

  const copyMyAddress = async () => {
    if (!user?.email) {
      return
    }

    try {
      await navigator.clipboard.writeText(mailboxAddressFor(user))
      setCopyStatus('복사됐어요')
      window.setTimeout(() => setCopyStatus(''), 1800)
    } catch {
      setCopyStatus('복사 실패')
    }
  }

  if (!authReady) {
    return (
      <main className="loading-screen">
        <div className="loading-mark">Love Letters</div>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-hero">
          <p className="eyebrow">Private letter room</p>
          <h1>둘만의 편지가 차곡차곡 쌓이는 공간</h1>
          <p>
            오늘의 말, 오래 남기고 싶은 장면, 문득 꺼내 보고 싶은 마음을
            조용히 모아두는 둘만의 편지함이에요.
          </p>
        </section>

        <form className="auth-panel" onSubmit={handleAuthSubmit}>
          <div className="auth-tabs" aria-label="로그인 방식">
            <button
              type="button"
              className={authMode === 'signIn' ? 'active' : ''}
              onClick={() => setAuthMode('signIn')}
            >
              로그인
            </button>
            <button
              type="button"
              className={authMode === 'signUp' ? 'active' : ''}
              onClick={() => setAuthMode('signUp')}
            >
              가입하기
            </button>
          </div>

          <h2>{authMode === 'signIn' ? '다시 들어오기' : '편지함 만들기'}</h2>

          {authMode === 'signUp' && (
            <label>
              <span>이름</span>
              <input
                value={authForm.name}
                onChange={updateAuthForm('name')}
                placeholder="상대에게 보일 이름"
                autoComplete="name"
              />
            </label>
          )}

          <label>
            <span>이메일</span>
            <input
              value={authForm.email}
              onChange={updateAuthForm('email')}
              placeholder="name@example.com"
              type="email"
              autoComplete="email"
              required
            />
          </label>

          <label>
            <span>비밀번호</span>
            <input
              value={authForm.password}
              onChange={updateAuthForm('password')}
              placeholder="6자 이상"
              type="password"
              autoComplete={
                authMode === 'signIn' ? 'current-password' : 'new-password'
              }
              required
            />
          </label>

          {authError && <p className="form-message error">{authError}</p>}

          <button className="button primary" type="submit" disabled={authLoading}>
            {authLoading
              ? '잠시만요'
              : authMode === 'signIn'
                ? '로그인'
                : '가입하고 시작'}
          </button>

          <div className="auth-divider">
            <span>또는</span>
          </div>

          <button
            className="button kakao"
            type="button"
            disabled={kakaoLoading || authLoading}
            onClick={startKakaoLogin}
          >
            <span aria-hidden="true">K</span>
            {kakaoLoading ? '카카오 확인 중' : '카카오로 시작하기'}
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <a className="brand" href="#top" aria-label="Love Letters 홈">
          <span>Love</span>
          <strong>Letters</strong>
        </a>
        <div className="user-menu">
          <div>
            <strong>{displayNameFor(user)}</strong>
            <span>{mailboxAddressFor(user)}</span>
          </div>
          <button className="button ghost" type="button" onClick={copyMyAddress}>
            {copyStatus || '내 편지 주소 복사'}
          </button>
          <button className="button ghost" type="button" onClick={() => signOut(auth)}>
            로그아웃
          </button>
        </div>
      </header>

      <section className="dashboard-hero" id="top">
        <div>
          <p className="eyebrow">Our archive</p>
          <h1>오늘의 마음도 오래 남겨두기</h1>
          <p>
            받은 말과 보낸 마음이 한곳에 남아, 시간이 지나도 다시 펼쳐볼 수
            있어요.
          </p>
        </div>
        <dl className="stats-panel">
          <div>
            <dt>받은 편지</dt>
            <dd>{receivedLetters.length}</dd>
          </div>
          <div>
            <dt>읽지 않음</dt>
            <dd>{unreadCount}</dd>
          </div>
          <div>
            <dt>보낸 편지</dt>
            <dd>{sentLetters.length}</dd>
          </div>
        </dl>
      </section>

      <section className="letter-board">
        <form className="compose-panel" onSubmit={handleSendLetter}>
          <div className="section-heading">
            <p className="eyebrow">Write</p>
            <h2>새 편지 쓰기</h2>
          </div>

          <div className="field-grid">
            <label>
              <span>받는 사람 편지 주소</span>
              <input
                value={compose.recipientEmail}
                onChange={updateCompose('recipientEmail')}
                placeholder="상대가 복사해 준 편지 주소"
                type="email"
                required
              />
            </label>
            <label>
              <span>받는 사람 이름</span>
              <input
                value={compose.recipientName}
                onChange={updateCompose('recipientName')}
                placeholder="예: 사랑하는 민지"
              />
            </label>
            <label>
              <span>함께한 날짜</span>
              <input
                value={compose.sharedDate}
                onChange={updateCompose('sharedDate')}
                placeholder="예: 2026.05.17"
              />
            </label>
            <label>
              <span>추억의 장소</span>
              <input
                value={compose.memoryPlace}
                onChange={updateCompose('memoryPlace')}
                placeholder="예: 처음 만난 카페"
              />
            </label>
          </div>

          <label>
            <span>제목</span>
            <input
              value={compose.title}
              onChange={updateCompose('title')}
              placeholder="편지 제목"
              required
            />
          </label>

          <label>
            <span>편지 내용</span>
            <textarea
              value={compose.message}
              onChange={updateCompose('message')}
              placeholder="전하고 싶은 마음을 적어주세요."
              rows={9}
              required
            />
          </label>

          <div className="photo-upload-field">
            <label>
              <span>사진 업로드</span>
              <input
                ref={photoInputRef}
                onChange={handlePhotoChange}
                type="file"
                accept="image/*"
              />
            </label>

            {photoFile && (
              <div className="photo-preview">
                {photoPreviewUrl && (
                  <img src={photoPreviewUrl} alt="업로드할 추억 미리보기" />
                )}
                <div>
                  <strong>{photoFile.name}</strong>
                  <small>{(photoFile.size / 1024 / 1024).toFixed(1)}MB</small>
                  <button
                    className="button ghost"
                    type="button"
                    onClick={clearPhoto}
                  >
                    사진 제거
                  </button>
                </div>
              </div>
            )}
          </div>

          {sendStatus && <p className="form-message">{sendStatus}</p>}

          <button className="button primary" type="submit" disabled={sendLoading}>
            {sendLoading ? '사진과 편지 저장 중' : '편지 보내기'}
          </button>
        </form>

        <section className="mailbox-panel" aria-label="편지함">
          <div className="mailbox-top">
            <div className="section-heading">
              <p className="eyebrow">Mailbox</p>
              <h2>편지 기록</h2>
            </div>
            <div className="mailbox-tabs" aria-label="편지함 선택">
              <button
                type="button"
                className={mailboxTab === 'received' ? 'active' : ''}
                onClick={() => setMailboxTab('received')}
              >
                받은 편지
              </button>
              <button
                type="button"
                className={mailboxTab === 'sent' ? 'active' : ''}
                onClick={() => setMailboxTab('sent')}
              >
                보낸 편지
              </button>
            </div>
          </div>

          {mailboxError && <p className="form-message error">{mailboxError}</p>}

          <div className="mailbox-layout">
            <div className="letter-list">
              {activeLetters.length ? (
                activeLetters.map((letter) => (
                  <button
                    key={letter.id}
                    type="button"
                    className={selectedLetter?.id === letter.id ? 'active' : ''}
                    onClick={() => openLetter(letter)}
                  >
                    <span className="list-meta">
                      {mailboxTab === 'received'
                        ? letter.senderName
                        : letter.recipientName || letter.recipientEmail}
                    </span>
                    <strong>{letter.title}</strong>
                    <small>
                      {formatDate(letter.createdAt)}
                      {mailboxTab === 'received' && !letter.readAt ? ' · 새 편지' : ''}
                    </small>
                  </button>
                ))
              ) : (
                <div className="empty-state">
                  {mailboxTab === 'received'
                    ? '아직 받은 편지가 없어요.'
                    : '아직 보낸 편지가 없어요.'}
                </div>
              )}
            </div>

            <article className="letter-detail">
              {selectedLetter ? (
                <>
                  <div className="letter-ribbon">
                    {mailboxTab === 'received' ? '받은 편지' : '보낸 편지'}
                  </div>
                  <header>
                    <p>{formatDate(selectedLetter.createdAt)}</p>
                    <h3>{selectedLetter.title}</h3>
                    <span>
                      {mailboxTab === 'received'
                        ? `${selectedLetter.senderName}에게서`
                        : `${selectedLetter.recipientName || selectedLetter.recipientEmail}에게`}
                    </span>
                  </header>

                  {(selectedLetter.sharedDate || selectedLetter.memoryPlace) && (
                    <dl className="letter-facts">
                      {selectedLetter.sharedDate && (
                        <div>
                          <dt>날짜</dt>
                          <dd>{selectedLetter.sharedDate}</dd>
                        </div>
                      )}
                      {selectedLetter.memoryPlace && (
                        <div>
                          <dt>장소</dt>
                          <dd>{selectedLetter.memoryPlace}</dd>
                        </div>
                      )}
                    </dl>
                  )}

                  {selectedLetter.photoUrl && (
                    <img
                      className="letter-photo"
                      src={selectedLetter.photoUrl}
                      alt="편지에 담긴 추억"
                    />
                  )}

                  <p className="letter-message">{selectedLetter.message}</p>

                  <footer>
                    <span>
                      {mailboxTab === 'received'
                        ? selectedLetter.senderEmail
                        : selectedLetter.recipientEmail}
                    </span>
                    <strong>
                      {selectedLetter.readAt
                        ? `읽은 시간 ${formatDate(selectedLetter.readAt)}`
                        : '아직 읽지 않음'}
                    </strong>
                  </footer>
                </>
              ) : (
                <div className="empty-detail">열어볼 편지를 선택해 주세요.</div>
              )}
            </article>
          </div>
        </section>
      </section>
    </main>
  )
}

export default App
