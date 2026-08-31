import assert from 'node:assert/strict'
import test from 'node:test'
import { Employee } from '../src/models/Employee.js'
import { Student } from '../src/models/Student.js'

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
