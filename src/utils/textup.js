function normalizeTextUpPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  return /^\d{9}$/.test(digits) ? `+998${digits}` : null
}

let cachedSession = null
let sessionPromise = null
let cachedTemplateId = null
const textUpTimeout = () => AbortSignal.timeout(Math.max(1000, Number(process.env.TEXTUP_TIMEOUT_MS || 8000)))

const tokenExpiry = (token) => {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'))
    if (Number.isFinite(payload.exp)) return payload.exp * 1000
  } catch (_error) { /* JWT bo‘lmasa xavfsiz qisqa cache ishlatiladi */ }
  return Date.now() + 45 * 60 * 1000
}

async function loginTextUp({ force = false } = {}) {
  if (!force && cachedSession?.expiresAt > Date.now() + 60_000) return cachedSession
  if (!force && sessionPromise) return sessionPromise
  const email = process.env.TEXTUP_EMAIL
  const password = process.env.TEXTUP_PASSWORD
  if (!email || !password) throw new Error('TEXTUP_EMAIL va TEXTUP_PASSWORD .env faylida kiritilmagan')
  sessionPromise = (async () => {
    const response = await fetch('https://api-auth.textup.uz/v1/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: textUpTimeout(),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload.accessToken || !payload.user?.id) throw new Error('TextUp tizimiga kirib bo‘lmadi. Email va parolni tekshiring')
    cachedSession = { accessToken: payload.accessToken, userId: payload.user.id, expiresAt: tokenExpiry(payload.accessToken) }
    return cachedSession
  })()
  try { return await sessionPromise }
  finally { sessionPromise = null }
}

export function renderDebtorSms(template, values) {
  return String(template || '')
    .replace(/\{(studentName|debtAmount|period|hostelName)\}/g, (_match, key) => values[key] || '')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizedText(value) {
  return String(value || '').toLocaleLowerCase().replace(/[‘’`]/g, "'").replace(/\s+/g, ' ').trim()
}

function templateMatchesMessage(templateContent, message) {
  const template = normalizedText(templateContent)
  const renderedMessage = normalizedText(message)
  if (template === renderedMessage) return true
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[^}]+\\\}/g, '.+?')
  return new RegExp(`^${escaped}$`, 'i').test(renderedMessage)
}

async function resolveTextUpTemplateId({ accessToken, userId, content }) {
  if (process.env.TEXTUP_TEMPLATE_ID) return process.env.TEXTUP_TEMPLATE_ID
  if (cachedTemplateId) return cachedTemplateId
  const query = new URLSearchParams({ page: '1', limit: '100', userId })
  const response = await fetch(`https://api-auth.textup.uz/v1/templates?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    signal: textUpTimeout(),
  })
  if (!response.ok) throw new Error(`TextUp template ro‘yxatini olib bo‘lmadi (${response.status})`)
  const payload = await response.json().catch(() => ({}))
  const templates = Array.isArray(payload.templates) ? payload.templates : []
  const activeTemplates = templates.filter((item) => ['active', 'approved', 'accepted'].includes(String(item.status || '').toLowerCase()))
  const template = activeTemplates.find((item) => templateMatchesMessage(item.content, content)) || activeTemplates[0]
  if (!template?.id) throw new Error('TextUp’da faol tasdiqlangan template topilmadi')
  cachedTemplateId = template.id
  return cachedTemplateId
}

export async function sendTextUpSms({ destination, content }) {
  const phone = normalizeTextUpPhone(destination)
  if (!phone) throw new Error('Talabaning telefon raqami noto‘g‘ri')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const session = await loginTextUp({ force: attempt > 0 })
    const templateId = await resolveTextUpTemplateId({ accessToken: session.accessToken, userId: session.userId, content })
    const response = await fetch('https://sms-api.textup.uz/v1/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: content,
        userId: session.userId,
        name: 'Qarzdorlik eslatmasi',
        recipients: [phone],
        templateId,
        ...(process.env.TEXTUP_NICKNAME_ID ? { nicknameId: process.env.TEXTUP_NICKNAME_ID } : {}),
      }),
      signal: textUpTimeout(),
    })
    if (response.ok) return phone
    if (response.status === 401 && attempt === 0) {
      cachedSession = null
      cachedTemplateId = null
      continue
    }
    const rawDetails = await response.text().catch(() => '')
    let details = rawDetails
    try {
      const parsed = JSON.parse(rawDetails)
      details = parsed.message || parsed.error || parsed.detail || rawDetails
    } catch (_error) { /* TextUp matnli xato qaytarishi mumkin */ }
    console.error('TextUp send error:', { status: response.status, details })
    throw new Error(`TextUp SMS yuborilmadi (${response.status})${details ? `: ${String(details).slice(0, 300)}` : ''}`)
  }
  throw new Error('TextUp SMS yuborilmadi')
}
