const parseJson = (value) => {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text.startsWith('{') && !text.startsWith('[')) return null
  try { return JSON.parse(text) } catch { return null }
}

const xmlField = (text, names) => {
  if (!text) return null
  for (const name of names) {
    const match = String(text).match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]+)</${name}>`, 'i'))
    if (match?.[1]) return match[1].trim()
  }
  return null
}

const findField = (value, names, seen = new Set()) => {
  if (value == null) return null
  if (typeof value === 'string') {
    const nested = parseJson(value)
    return nested ? findField(nested, names, seen) : null
  }
  if (typeof value !== 'object' || seen.has(value)) return null
  seen.add(value)
  const wanted = new Set(names.map((name) => name.toLowerCase()))
  for (const [key, nestedValue] of Object.entries(value)) {
    if (wanted.has(key.toLowerCase()) && ['string', 'number'].includes(typeof nestedValue)) {
      const result = String(nestedValue).trim()
      if (result) return result
    }
  }
  for (const nestedValue of Object.values(value)) {
    const result = findField(nestedValue, names, seen)
    if (result) return result
  }
  return null
}

const textualFile = (file) => {
  const type = String(file?.mimetype || '').toLowerCase()
  const name = String(file?.originalname || '').toLowerCase()
  return type.includes('json') || type.includes('xml') || type.startsWith('text/') || /\.(json|xml|txt)$/.test(name)
}

export function extractHikvisionEvent(req) {
  let data = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : null
  let raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : ''

  for (const file of req.files || []) {
    if (!textualFile(file)) continue
    const text = file.buffer.toString('utf8')
    raw ||= text
    data ||= parseJson(text)
  }
  data ||= parseJson(raw)
  if (data && Object.keys(data).length === 1) {
    const first = data[Object.keys(data)[0]]
    data = parseJson(first) || data
  }

  const get = (names) => findField(data, names) || xmlField(raw, names)
  return {
    faceCode: get(['employeeNoString', 'employeeNo', 'EmployeeNo', 'employeeID', 'jobNo', 'userId', 'cardNo', 'CardNo']),
    personName: get(['name', 'employeeName', 'userName', 'personName']),
    dateTime: get(['dateTime', 'DateTime', 'eventTime', 'occurredAt']) || new Date().toISOString(),
    eventType: get(['eventType', 'EventType', 'eventDescription', 'minorEventType']),
    sourceEventId: get(['eventId', 'eventID', 'UUID', 'uuid']),
    serialNo: get(['serialNo', 'SerialNo', 'eventSerialNo']),
    deviceId: get(['deviceID', 'deviceId', 'DeviceID', 'devIndex', 'deviceSerialNo']),
  }
}

export const isHeartbeatEvent = (payload) => ['heartbeat', 'keepalive', 'keep-alive'].includes(String(payload?.eventType || '').trim().toLowerCase())
