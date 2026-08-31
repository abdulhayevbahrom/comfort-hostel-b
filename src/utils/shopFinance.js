const paymentTypes = ['cash', 'card', 'click', 'bank']

const emptyMethods = () => ({ cash: 0, card: 0, click: 0, bank: 0 })
const mapMethods = (rows) => rows.reduce(
  (result, row) => ({ ...result, [row._id]: Number(row.amount || 0) }),
  emptyMethods(),
)
const sum = (values) => Object.values(values).reduce((total, value) => total + Number(value || 0), 0)

export function shopPeriodRange(period) {
  const [year, month] = period.split('-').map(Number)
  const tashkentOffset = 5 * 60 * 60 * 1000
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - tashkentOffset),
    end: new Date(Date.UTC(year, month, 1) - tashkentOffset),
  }
}

export function calculateShopBalance(incomeRows = [], expenseRows = [], salaryRows = []) {
  const income = mapMethods(incomeRows)
  const expenses = mapMethods(expenseRows)
  const salaries = mapMethods(salaryRows)
  const methods = Object.fromEntries(paymentTypes.map((method) => [
    method,
    income[method] - expenses[method] - salaries[method],
  ]))
  return {
    income: sum(income),
    expenses: sum(expenses),
    salaries: sum(salaries),
    balance: sum(methods),
    methods,
  }
}
