import assert from 'node:assert/strict'
import test from 'node:test'
import { Employee } from '../src/models/Employee.js'
import { Student } from '../src/models/Student.js'
import { isValidFaceIdCode, normalizeFaceIdCode } from '../src/utils/faceIdCode.js'

test('yangi talaba uchun Hikvision qabul qiladigan harf-raqam FaceID kodi yaratiladi', async () => {
  const student = new Student({ fullName: 'Test Talaba', phone: '901234567', gender: 'male', course: 1 })
  await student.validate()
  assert.match(student.faceIdCode, /^STU[A-F0-9]{12}$/)
  assert.equal(student.faceIdCode.includes('-'), false)
})

test('yangi xodim uchun Hikvision qabul qiladigan harf-raqam FaceID kodi yaratiladi', async () => {
  const employee = new Employee({ firstname: 'Test', lastname: 'Xodim', position: 'Admin' })
  await employee.validate()
  assert.match(employee.faceIdCode, /^EMP[A-F0-9]{12}$/)
  assert.equal(employee.faceIdCode.includes('-'), false)
})

test('FaceID kodi tahrirlanganda katta harfga o‘tkaziladi', async () => {
  const student = new Student({ faceIdCode: 'student2026', fullName: 'Test Talaba', phone: '901234567', gender: 'male', course: 1 })
  await student.validate()
  assert.equal(student.faceIdCode, 'STUDENT2026')
})

test('FaceID kodi faqat Hikvision qabul qiladigan harf va raqamlardan tuziladi', () => {
  assert.equal(normalizeFaceIdCode(' emp001 '), 'EMP001')
  assert.equal(isValidFaceIdCode('EMP001'), true)
  assert.equal(isValidFaceIdCode('EMP-001'), false)
  assert.equal(isValidFaceIdCode(''), false)
  assert.equal(isValidFaceIdCode('A'.repeat(33)), false)
})
