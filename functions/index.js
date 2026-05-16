import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'

initializeApp()

const KAKAO_TOKEN_URL = 'https://kauth.kakao.com/oauth/token'
const KAKAO_USER_URL = 'https://kapi.kakao.com/v2/user/me'
const kakaoRestApiKey = defineSecret('KAKAO_REST_API_KEY')
const kakaoClientSecret = defineSecret('KAKAO_CLIENT_SECRET')

async function readError(response) {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

async function exchangeCodeForToken({ code, redirectUri }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: kakaoRestApiKey.value(),
    redirect_uri: redirectUri,
    code,
  })
  const clientSecret = kakaoClientSecret.value()

  if (clientSecret) {
    body.set('client_secret', clientSecret)
  }

  const response = await fetch(KAKAO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
    body,
  })

  if (!response.ok) {
    throw new HttpsError(
      'unauthenticated',
      `Kakao token exchange failed: ${await readError(response)}`,
    )
  }

  return response.json()
}

async function fetchKakaoProfile(accessToken) {
  const response = await fetch(KAKAO_USER_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
  })

  if (!response.ok) {
    throw new HttpsError(
      'unauthenticated',
      `Kakao profile request failed: ${await readError(response)}`,
    )
  }

  return response.json()
}

async function getFirebaseUid({ kakaoId, email, displayName, photoURL }) {
  const auth = getAuth()
  const kakaoUid = `kakao_${kakaoId}`
  let uid = kakaoUid
  const profileUpdate = {
    emailVerified: true,
  }

  if (displayName) {
    profileUpdate.displayName = displayName
  }

  if (photoURL) {
    profileUpdate.photoURL = photoURL
  }

  try {
    const existingUser = await auth.getUserByEmail(email)
    uid = existingUser.uid
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') {
      throw error
    }
  }

  try {
    await auth.getUser(uid)
    await auth.updateUser(uid, profileUpdate)
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') {
      throw error
    }

    await auth.createUser({
      uid,
      email,
      ...profileUpdate,
    })
  }

  return uid
}

export const kakaoLogin = onCall(
  {
    region: 'us-central1',
    secrets: [kakaoRestApiKey, kakaoClientSecret],
  },
  async (request) => {
    const code = String(request.data?.code ?? '').trim()
    const redirectUri = String(request.data?.redirectUri ?? '').trim()

    if (!code || !redirectUri) {
      throw new HttpsError(
        'invalid-argument',
        'code and redirectUri are required.',
      )
    }

    const token = await exchangeCodeForToken({ code, redirectUri })
    const kakaoUser = await fetchKakaoProfile(token.access_token)
    const kakaoId = String(kakaoUser.id ?? '')
    const kakaoAccount = kakaoUser.kakao_account ?? {}
    const profile = kakaoAccount.profile ?? {}
    const email = String(kakaoAccount.email ?? '').trim().toLowerCase()
    const displayName = String(
      profile.nickname ?? kakaoUser.properties?.nickname ?? '카카오 사용자',
    )
    const photoURL = String(
      profile.profile_image_url ?? kakaoUser.properties?.profile_image ?? '',
    )

    if (!kakaoId) {
      throw new HttpsError('unauthenticated', 'Kakao user id was not returned.')
    }

    if (!email) {
      throw new HttpsError(
        'failed-precondition',
        'Kakao account email consent is required for this letter mailbox.',
      )
    }

    const uid = await getFirebaseUid({
      kakaoId,
      email,
      displayName,
      photoURL,
    })
    const customToken = await getAuth().createCustomToken(uid, {
      provider: 'kakao',
      kakaoId,
    })

    return {
      customToken,
      profile: {
        displayName,
        photoURL,
        email,
      },
    }
  },
)
