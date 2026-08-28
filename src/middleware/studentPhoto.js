import multer from 'multer'
import { ApiResponse } from '../utils/response.js'

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, callback) => allowedTypes.has(file.mimetype) ? callback(null, true) : callback(new Error('Rasm faqat JPG, PNG yoki WEBP formatida bo‘lishi mumkin')),
}).fields([{ name: 'photo', maxCount: 1 }, { name: 'marriageCertificate', maxCount: 1 }])

export function uploadStudentPhoto(req, res, next) {
  upload(req, res, (error) => {
    if (!error) return next()
    return ApiResponse.badRequest(res, error.code === 'LIMIT_FILE_SIZE' ? 'Yuz rasmi 5 MB dan oshmasligi kerak' : error.message)
  })
}

export function parseStudentPayload(req, res, next) {
  try { req.body = JSON.parse(req.body.payload || '{}'); return next() }
  catch { return ApiResponse.badRequest(res, 'Talaba ma’lumotlari noto‘g‘ri formatda') }
}
