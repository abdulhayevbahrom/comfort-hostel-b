import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RECEIPT_MAX_BYTES } from '../middleware/paymentReceipt.js'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const receiptRoot = () => path.resolve(process.env.PAYMENT_RECEIPT_DIR || path.join(backendRoot, 'private_uploads/payment-receipts'))
const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }
const filenamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i

const matchesImageContent = (file) => {
  const bytes = file.buffer
  if (file.mimetype === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (file.mimetype === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (file.mimetype === 'image/webp') return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  return false
}

export async function savePaymentReceipt(file) {
  if (!file?.buffer?.length || file.buffer.length > RECEIPT_MAX_BYTES) {
    throw Object.assign(new Error('Kvitansiya rasmi 1,5 MB dan oshmasligi kerak'), { statusCode: 400 })
  }
  const extension = extensions[file?.mimetype]
  if (!extension || !matchesImageContent(file)) {
    throw Object.assign(new Error('Kvitansiya haqiqiy JPG, PNG yoki WEBP rasm bo‘lishi kerak'), { statusCode: 400 })
  }
  const filename = `${randomUUID()}${extension}`
  await fs.mkdir(receiptRoot(), { recursive: true })
  await fs.writeFile(path.join(receiptRoot(), filename), file.buffer, { flag: 'wx' })
  return `/payments/receipt/${filename}`
}

export function paymentReceiptFile(filename) {
  return filenamePattern.test(filename) ? path.join(receiptRoot(), filename) : null
}

export function isReceiptImageReference(value) {
  if (!value) return true
  return /^\/payments\/receipt\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i.test(value)
}
