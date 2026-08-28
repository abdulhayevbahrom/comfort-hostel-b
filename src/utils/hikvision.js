import crypto from 'node:crypto'

export const HIKVISION_TRANSPORTS = ['isup_gateway', 'direct_isapi']

const md5 = (value) => crypto.createHash('md5').update(value).digest('hex')
export const parseDigestChallenge = (header) => {
  if (!header || !/^Digest\s/i.test(header)) return null
  const values = {}; const source = header.replace(/^Digest\s+/i, ''); const pattern = /(\w+)=(?:"([^"]*)"|([^,\s]+))/g
  let match
  while ((match = pattern.exec(source))) values[match[1]] = match[2] ?? match[3]
  return values.realm && values.nonce ? values : null
}
export function digestAuthorization({ challenge, username, password, method, uri }) {
  const qop = String(challenge.qop || '').split(',').map((item) => item.trim()).find((item) => item === 'auth')
  const nc = '00000001'; const cnonce = crypto.randomBytes(8).toString('hex')
  let ha1 = md5(`${username}:${challenge.realm}:${password}`)
  if (String(challenge.algorithm || '').toUpperCase() === 'MD5-SESS') ha1 = md5(`${ha1}:${challenge.nonce}:${cnonce}`)
  const ha2 = md5(`${method}:${uri}`)
  const response = qop ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${challenge.nonce}:${ha2}`)
  const fields = [`username="${username}"`, `realm="${challenge.realm}"`, `nonce="${challenge.nonce}"`, `uri="${uri}"`, `response="${response}"`]
  if (challenge.algorithm) fields.push(`algorithm=${challenge.algorithm}`)
  if (challenge.opaque) fields.push(`opaque="${challenge.opaque}"`)
  if (qop) fields.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`)
  return `Digest ${fields.join(', ')}`
}

export async function requestWithDeviceAuth({ url, username, password, method, headers, body }) {
  const send = (authorization) => fetch(url, { method, headers: { ...headers, ...(authorization ? { Authorization: authorization } : {}) }, body, signal: AbortSignal.timeout(Number(process.env.HIKVISION_TIMEOUT_MS || 5000)) })
  if (String(process.env.HIKVISION_AUTH_MODE || 'digest').toLowerCase() === 'basic') return send(`Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`)
  let response = await send(null)
  if (response.status !== 401) return response
  const challenge = parseDigestChallenge(response.headers.get('www-authenticate'))
  if (!challenge) return response
  await response.arrayBuffer().catch(() => null)
  const parsed = new URL(url); const uri = `${parsed.pathname}${parsed.search}`
  response = await send(digestAuthorization({ challenge, username, password, method, uri }))
  return response
}

const textFromResponse = async (response) => response.text().catch(() => '')
const parsedJson = (value) => {
  try { return JSON.parse(value) } catch { return null }
}
const hikvisionStatusCode = (payload, text) => {
  const value = payload?.ResponseStatus?.statusCode ?? payload?.statusCode
  if (value !== undefined && value !== null && value !== '') return Number(value)
  const match = String(text || '').match(/<statusCode>(\d+)<\/statusCode>/i)
  return match ? Number(match[1]) : null
}
const failedHikvisionStatus = (status) => Number.isFinite(status) && status !== 1 && (status < 200 || status >= 300)
const deviceTransport = (device) => HIKVISION_TRANSPORTS.includes(device?.transport)
  ? device.transport
  : String(device?.host || '').trim() ? 'direct_isapi' : 'isup_gateway'
const doorControlEnabled = (device, force) => force || (device?.doorControlEnabled ?? (process.env.HIKVISION_DOOR_CONTROL_ENABLED === 'true'))

const validateHttpUrl = (value, label) => {
  let url
  try { url = new URL(value) } catch { throw new Error(`${label} noto‘g‘ri URL`) }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${label} faqat HTTP yoki HTTPS bo‘lishi kerak`)
  return url.toString()
}

const gatewayUrl = (device, isapiPath) => {
  const deviceId = String(device?.isupDeviceId || '').trim()
  if (!deviceId) throw new Error('Hikvision ISUP Device ID sozlanmagan')
  const template = String(process.env.HIKVISION_GATEWAY_DEVICE_URL_TEMPLATE || '').trim()
  if (!template) throw new Error('HIKVISION_GATEWAY_DEVICE_URL_TEMPLATE sozlanmagan')
  const value = template
    .replaceAll('{deviceId}', encodeURIComponent(deviceId))
    .replaceAll('{isapiPath}', isapiPath)
    .replaceAll('{encodedIsapiPath}', encodeURIComponent(isapiPath))
  return { deviceId, url: validateHttpUrl(value, 'Hikvision gateway manzili') }
}

async function requestThroughIsupGateway(device, request) {
  const { deviceId, url } = gatewayUrl(device, request.path)
  const mode = String(process.env.HIKVISION_GATEWAY_REQUEST_MODE || 'bridge').toLowerCase()
  const token = String(process.env.HIKVISION_GATEWAY_TOKEN || '').trim()
  const commonHeaders = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'X-Hikvision-Device-Id': deviceId,
  }
  let response
  if (mode === 'raw') {
    response = await fetch(url, {
      method: request.method,
      headers: { ...commonHeaders, 'Content-Type': request.contentType },
      body: request.body,
      signal: AbortSignal.timeout(Number(process.env.HIKVISION_GATEWAY_TIMEOUT_MS || 4000)),
    })
  } else if (mode === 'bridge') {
    response = await fetch(url, {
      method: 'POST',
      headers: { ...commonHeaders, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        deviceId,
        operation: request.operation,
        request: { method: request.method, path: request.path, contentType: request.contentType, body: request.body },
      }),
      signal: AbortSignal.timeout(Number(process.env.HIKVISION_GATEWAY_TIMEOUT_MS || 4000)),
    })
  } else {
    throw new Error('HIKVISION_GATEWAY_REQUEST_MODE bridge yoki raw bo‘lishi kerak')
  }

  const details = await textFromResponse(response)
  const payload = parsedJson(details)
  const proxiedStatus = Number(payload?.status || response.status)
  const deviceStatus = hikvisionStatusCode(payload, details)
  const gatewayRejected = payload?.ok === false || payload?.success === false || proxiedStatus >= 400 || failedHikvisionStatus(deviceStatus)
  if (!response.ok || gatewayRejected) {
    throw new Error(`Hikvision ISUP gateway buyrug‘i bajarilmadi (${proxiedStatus || response.status}): ${details.slice(0, 300)}`)
  }
  return { status: proxiedStatus || response.status, details, payload }
}

async function requestDirectIsapi(device, request) {
  const host = String(device?.host || process.env.HIKVISION_HOST || '').replace(/\/$/, '')
  const username = process.env.HIKVISION_USERNAME
  const password = process.env.HIKVISION_PASSWORD
  if (!host || !username || !password) throw new Error('Hikvision host, username yoki password sozlanmagan')
  validateHttpUrl(host, 'Hikvision host')
  const response = await requestWithDeviceAuth({
    url: `${host}${request.path}`,
    username,
    password,
    method: request.method,
    headers: { 'Content-Type': request.contentType },
    body: request.body,
  })
  const details = await textFromResponse(response)
  const statusCode = hikvisionStatusCode(parsedJson(details), details)
  if (!response.ok || failedHikvisionStatus(statusCode)) throw new Error(`Hikvision buyrug‘i bajarilmadi (${statusCode || response.status}): ${details.slice(0, 200)}`)
  return { status: response.status, details }
}

async function requestHikvision(device, request) {
  const transport = deviceTransport(device)
  const result = transport === 'isup_gateway'
    ? await requestThroughIsupGateway(device, request)
    : await requestDirectIsapi(device, request)
  return { ...result, transport }
}

export async function openHikvisionDoor(device, { force = false } = {}) {
  if (!doorControlEnabled(device, force)) return { attempted: false, opened: false, reason: 'Door control o‘chirilgan', transport: deviceTransport(device) }
  const doorNo = Number(device?.doorNo || process.env.HIKVISION_DOOR_NO || 1)
  const path = String(process.env.HIKVISION_OPEN_DOOR_PATH || '/ISAPI/AccessControl/RemoteControl/door/{doorNo}').replace('{doorNo}', String(doorNo))
  const result = await requestHikvision(device, {
    operation: 'open_door',
    method: 'PUT',
    path,
    contentType: 'application/xml; charset=UTF-8',
    body: '<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>',
  })
  return { attempted: true, opened: true, status: result.status, transport: result.transport }
}

export async function sendHikvisionRemoteCheck(device, { serialNo, allowed, info = '' }) {
  if (!doorControlEnabled(device, false)) return { attempted: false, opened: false, reason: 'Door control o‘chirilgan', transport: deviceTransport(device) }
  if (!Number.isInteger(Number(serialNo))) throw new Error('Hikvision remote check uchun serialNo kelmadi')
  const path = String(process.env.HIKVISION_REMOTE_CHECK_PATH || '/ISAPI/AccessControl/remoteCheck?format=json')
  const result = await requestHikvision(device, {
    operation: 'remote_check',
    method: 'PUT',
    path,
    contentType: 'application/json; charset=UTF-8',
    body: JSON.stringify({ RemoteCheck: { serialNo: Number(serialNo), checkResult: allowed ? 'success' : 'failed', info: String(info || '').slice(0, 32) } }),
  })
  return { attempted: true, opened: Boolean(allowed), status: result.status, mode: 'remote_check', transport: result.transport }
}
