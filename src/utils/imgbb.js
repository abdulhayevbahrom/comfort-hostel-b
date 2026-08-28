const IMGBB_ENDPOINT = 'https://api.imgbb.com/1/upload'

async function uploadImage(file) {
  const apiKey = process.env.IMGBB_API_KEY
  if (!apiKey) throw new Error('IMGBB_API_KEY sozlanmagan')

  const body = new FormData()
  body.append('image', new Blob([file.buffer], { type: file.mimetype }), file.originalname)
  const response = await fetch(`${IMGBB_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, { method: 'POST', body })
  const result = await response.json()
  if (!response.ok || !result?.success) throw new Error(result?.error?.message || 'ImgBB’ga rasm yuklanmadi')
  return { url: result.data.url, displayUrl: result.data.display_url || result.data.url, thumbnailUrl: result.data.thumb?.url || result.data.url }
}

export function uploadImages(files = []) {
  return Promise.all(files.map(uploadImage))
}
