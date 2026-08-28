export class ApiResponse {
  static send(res, status, data = null, message = null) {
    return res.status(status).json({
      success: status >= 200 && status < 300,
      ...(message ? { message } : {}),
      ...(data !== null ? { data } : {}),
    })
  }

  static ok(res, data = null, message = null) {
    return this.send(res, 200, data, message)
  }

  static created(res, data = null, message = 'Muvaffaqiyatli yaratildi') {
    return this.send(res, 201, data, message)
  }

  static badRequest(res, message = 'Noto‘g‘ri so‘rov', data = null) {
    return this.send(res, 400, data, message)
  }

  static unauthorized(res, message = 'Avtorizatsiyadan o‘tilmagan') {
    return this.send(res, 401, null, message)
  }

  static forbidden(res, message = 'Ruxsat berilmagan') {
    return this.send(res, 403, null, message)
  }

  static notFound(res, message = 'Ma’lumot topilmadi') {
    return this.send(res, 404, null, message)
  }

  static conflict(res, message = 'Ma’lumotlar to‘qnashuvi') {
    return this.send(res, 409, null, message)
  }

  static internal(res, message = 'Serverda xatolik yuz berdi') {
    return this.send(res, 500, null, message)
  }
}
