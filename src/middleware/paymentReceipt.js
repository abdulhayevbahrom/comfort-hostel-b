import multer from 'multer'
import { ApiResponse } from '../utils/response.js'

export const RECEIPT_MAX_BYTES = 1.5 * 1024 * 1024
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: RECEIPT_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
    ? callback(null, true)
    : callback(new Error('Kvitansiya faqat JPG, PNG yoki WEBP rasm bo‘lishi kerak')),
}).single('receipt')

export function uploadPaymentReceipt(req, res, next) {
  upload(req, res, (error) => {
    if (error) return ApiResponse.badRequest(res, error.code === 'LIMIT_FILE_SIZE' ? 'Kvitansiya rasmi 1,5 MB dan oshmasligi kerak' : error.message)
    if (!req.file) return ApiResponse.badRequest(res, 'Kvitansiya rasmini tanlang')
    next()
  })
}
