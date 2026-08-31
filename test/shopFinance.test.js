import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateShopBalance, shopPeriodRange } from '../src/utils/shopFinance.js'

test('do‘kon balansi kirimdan chiqim va faqat do‘kon oyligini ayiradi', () => {
  const result = calculateShopBalance(
    [{ _id: 'cash', amount: 1_000_000 }, { _id: 'card', amount: 500_000 }],
    [{ _id: 'cash', amount: 200_000 }],
    [{ _id: 'card', amount: 300_000 }],
  )

  assert.deepEqual(result, {
    income: 1_500_000,
    expenses: 200_000,
    salaries: 300_000,
    balance: 1_000_000,
    methods: { cash: 800_000, card: 200_000, click: 0, bank: 0 },
  })
})

test('do‘kon oyi Toshkent vaqti bo‘yicha chegaralanadi', () => {
  const range = shopPeriodRange('2026-09')
  assert.equal(range.start.toISOString(), '2026-08-31T19:00:00.000Z')
  assert.equal(range.end.toISOString(), '2026-09-30T19:00:00.000Z')
})
