import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'

const uploadRoot = () => path.resolve(process.env.PRIVATE_UPLOAD_DIR || 'private_uploads/passports')
const extensionFor = (mimetype) => ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' })[mimetype] || ''

export async function savePrivateImage(file, folder = '') {
  const ext = extensionFor(file.mimetype)
  if (!ext) throw new Error('Rasm faqat JPG, PNG yoki WEBP formatida bo‘lishi mumkin')
  const directory = path.join(uploadRoot(), folder)
  await fs.mkdir(directory, { recursive: true })
  const filename = `${Date.now()}-${crypto.randomUUID()}${ext}`
  const filePath = path.join(directory, filename)
  await fs.writeFile(filePath, file.buffer)
  return {
    path: path.relative(uploadRoot(), filePath),
    originalName: file.originalname || filename,
    mimetype: file.mimetype,
    size: file.size,
  }
}

export async function deletePrivateImage(image) {
  if (!image?.path) return false
  const fullPath = path.resolve(uploadRoot(), image.path)
  if (!fullPath.startsWith(uploadRoot())) return false
  try {
    await fs.unlink(fullPath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

export function privateImagePath(image) {
  if (!image?.path) return ''
  const fullPath = path.resolve(uploadRoot(), image.path)
  return fullPath.startsWith(uploadRoot()) ? fullPath : ''
}
