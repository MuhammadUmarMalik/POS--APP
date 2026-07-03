// Money is integer paisa everywhere. These are the ONLY conversion points.

export function formatMoney(paisa: number, currency = 'Rs'): string {
  const negative = paisa < 0
  const abs = Math.abs(paisa)
  const rupees = Math.floor(abs / 100)
  const cents = abs % 100
  const grouped = rupees.toLocaleString('en-IN')
  const body = cents === 0 ? grouped : `${grouped}.${String(cents).padStart(2, '0')}`
  return `${negative ? '-' : ''}${currency} ${body}`
}

/** "123.45" | 123.45 → 12345 paisa. Returns NaN for invalid input. */
export function toPaisa(value: string | number): number {
  const n = typeof value === 'string' ? parseFloat(value) : value
  if (Number.isNaN(n)) return NaN
  return Math.round(n * 100)
}

/** 12345 paisa → 123.45 for editing in forms. */
export function toRupees(paisa: number): number {
  return paisa / 100
}
