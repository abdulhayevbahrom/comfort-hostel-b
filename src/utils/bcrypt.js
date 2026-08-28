import bcrypt from 'bcrypt'

const SALT_ROUNDS = 12

export function validatePassword(password) {
  if (!password) return 'Parol kiritilishi shart'
  if (password.length < 8) return 'Parol kamida 8 ta belgidan iborat bo‘lsin'
  return null
}

export function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export function comparePassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash)
}
