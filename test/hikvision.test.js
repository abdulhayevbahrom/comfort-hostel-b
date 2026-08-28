import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDigestChallenge, sendHikvisionRemoteCheck } from '../src/utils/hikvision.js'

test('Digest challenge qiymatlari ajratiladi', () => {
  assert.deepEqual(parseDigestChallenge('Digest realm="Hikvision", nonce="abc", qop="auth", opaque="xyz"'), { realm: 'Hikvision', nonce: 'abc', qop: 'auth', opaque: 'xyz' })
})

test('remoteCheck qarori serialNo bilan digest orqali yuboriladi', async () => {
  const originalFetch = global.fetch
  const originalUsername = process.env.HIKVISION_USERNAME
  const originalPassword = process.env.HIKVISION_PASSWORD
  const originalAuthMode = process.env.HIKVISION_AUTH_MODE
  const calls = []
  process.env.HIKVISION_USERNAME = 'admin'
  process.env.HIKVISION_PASSWORD = 'secret'
  process.env.HIKVISION_AUTH_MODE = 'digest'
  global.fetch = async (url, options) => {
    calls.push({ url, options })
    if (calls.length === 1) return { status: 401, headers: { get: () => 'Digest realm="Hikvision", nonce="abc", qop="auth"' }, arrayBuffer: async () => new ArrayBuffer(0) }
    return { ok: true, status: 200, text: async () => '{"statusCode":1}' }
  }
  try {
    const result = await sendHikvisionRemoteCheck({ transport: 'direct_isapi', host: 'http://10.10.0.2', doorControlEnabled: true }, { serialNo: 17, allowed: false, info: 'Student denied' })
    assert.equal(result.opened, false)
    assert.equal(calls.length, 2)
    assert.match(calls[1].options.headers.Authorization, /^Digest /)
    assert.deepEqual(JSON.parse(calls[1].options.body), { RemoteCheck: { serialNo: 17, checkResult: 'failed', info: 'Student denied' } })
  } finally {
    global.fetch = originalFetch
    if (originalUsername === undefined) delete process.env.HIKVISION_USERNAME
    else process.env.HIKVISION_USERNAME = originalUsername
    if (originalPassword === undefined) delete process.env.HIKVISION_PASSWORD
    else process.env.HIKVISION_PASSWORD = originalPassword
    if (originalAuthMode === undefined) delete process.env.HIKVISION_AUTH_MODE
    else process.env.HIKVISION_AUTH_MODE = originalAuthMode
  }
})

test('ISUP gateway bridge orqali remoteCheck yuboriladi', async () => {
  const originalFetch = global.fetch
  const originalTemplate = process.env.HIKVISION_GATEWAY_DEVICE_URL_TEMPLATE
  const originalMode = process.env.HIKVISION_GATEWAY_REQUEST_MODE
  const originalToken = process.env.HIKVISION_GATEWAY_TOKEN
  const calls = []
  process.env.HIKVISION_GATEWAY_DEVICE_URL_TEMPLATE = 'http://127.0.0.1:9010/devices/{deviceId}/isapi'
  process.env.HIKVISION_GATEWAY_REQUEST_MODE = 'bridge'
  process.env.HIKVISION_GATEWAY_TOKEN = 'gateway-token'
  global.fetch = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, status: 200, text: async () => '{"ok":true,"status":200}' }
  }
  try {
    const result = await sendHikvisionRemoteCheck({ transport: 'isup_gateway', isupDeviceId: 'DEVICE 01', doorControlEnabled: true }, { serialNo: 44, allowed: true, info: 'Student granted' })
    assert.equal(result.opened, true)
    assert.equal(result.transport, 'isup_gateway')
    assert.equal(calls[0].url, 'http://127.0.0.1:9010/devices/DEVICE%2001/isapi')
    assert.equal(calls[0].options.method, 'POST')
    assert.equal(calls[0].options.headers.Authorization, 'Bearer gateway-token')
    const envelope = JSON.parse(calls[0].options.body)
    assert.equal(envelope.operation, 'remote_check')
    assert.equal(envelope.request.method, 'PUT')
    assert.match(envelope.request.path, /remoteCheck/)
  } finally {
    global.fetch = originalFetch
    if (originalTemplate === undefined) delete process.env.HIKVISION_GATEWAY_DEVICE_URL_TEMPLATE
    else process.env.HIKVISION_GATEWAY_DEVICE_URL_TEMPLATE = originalTemplate
    if (originalMode === undefined) delete process.env.HIKVISION_GATEWAY_REQUEST_MODE
    else process.env.HIKVISION_GATEWAY_REQUEST_MODE = originalMode
    if (originalToken === undefined) delete process.env.HIKVISION_GATEWAY_TOKEN
    else process.env.HIKVISION_GATEWAY_TOKEN = originalToken
  }
})
