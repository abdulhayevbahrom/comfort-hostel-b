import multer from 'multer'
import { ApiResponse } from '../utils/response.js'

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => allowedTypes.has(file.mimetype) ? callback(null, true) : callback(new Error('Logo faqat JPG, PNG yoki WEBP formatida bo‘lishi mumkin')),
}).single('logo')

export function uploadSettingLogo(req, res, next) {
  upload(req, res, (error) => {
    if (!error) return next()
    return ApiResponse.badRequest(res, error.code === 'LIMIT_FILE_SIZE' ? 'Logo 5 MB dan oshmasligi kerak' : error.message)
  })
}

export function parseSettingPayload(req, res, next) {
  try { req.body = JSON.parse(req.body.payload || '{}'); return next() }
  catch { return ApiResponse.badRequest(res, 'Sozlamalar noto‘g‘ri formatda') }
}
