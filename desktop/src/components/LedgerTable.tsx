// Dues ledger for a customer or supplier: chronological debit/credit with running balance.
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/ipc'
import { formatMoney } from '../lib/money'
import { formatDateTime } from '../lib/utils'
import { useCurrency } from '../stores/auth'
import type { LedgerEntry } from '../shared/types'
import { section } from '../lib/export'
import { ExportBar } from './ExportBar'
import { Spinner } from './ui'

export function LedgerTable({
  channel,
  partyId,
  exportModule,
  exportScope,
  exportTitle,
}: {
  channel: 'customers:ledger' | 'suppliers:ledger'
  partyId: string
  /** Pass these to show Print / PDF / CSV above the table. */
  exportModule?: string
  exportScope?: string
  exportTitle?: string
}) {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['ledger', channel, partyId],
    queryFn: () => api<LedgerEntry[]>(channel, { id: partyId }),
  })

  if (isLoading) return <Spinner />
  if (!data || data.length === 0) {
    return <p className="text-muted">No balance activity yet — only credit transactions, payments and returns appear here.</p>
  }

  const totalDebit = data.reduce((a, e) => a + e.debit, 0)
  const totalCredit = data.reduce((a, e) => a + e.credit, 0)
  const closing = data[data.length - 1].balance

  return (
    <>
    {exportModule && (
      <div className="no-print mb-2 flex justify-end">
        <ExportBar
          module={exportModule}
          scope={exportScope}
          csv
          buildDoc={() => ({
            module: exportModule,
            scope: exportScope,
            title: exportTitle ?? 'Ledger',
            subtitle: exportScope,
            sections: [
              section({
                columns: [
                  { header: 'Date', value: (e: LedgerEntry) => formatDateTime(e.date) },
                  { header: 'Entry', value: (e) => e.type },
                  { header: 'Ref', value: (e) => e.description },
                  { header: 'Debit', value: (e) => (e.debit ? e.debit : ''), money: true },
                  { header: 'Credit', value: (e) => (e.credit ? e.credit : ''), money: true },
                  { header: 'Balance', value: (e) => e.balance, money: true },
                ],
                rows: data,
                footer: ['Total', '', '', totalDebit, totalCredit, closing],
              }),
            ],
            note: 'Debit increases the balance owed; credit reduces it. Balance is the running total after each entry.',
          })}
        />
      </div>
    )}
    <div className="max-h-72 overflow-y-auto rounded-md border border-line">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-muted">
          <tr>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Entry</th>
            <th className="px-3 py-2">Ref</th>
            <th className="px-3 py-2 text-right">Debit</th>
            <th className="px-3 py-2 text-right">Credit</th>
            <th className="px-3 py-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {data.map((e, i) => (
            <tr key={i} className="border-t border-line">
              <td className="whitespace-nowrap px-3 py-2 text-muted">{formatDateTime(e.date)}</td>
              <td className="px-3 py-2">{e.type}</td>
              <td className="max-w-32 truncate px-3 py-2 text-muted" title={e.description}>
                {e.description}
              </td>
              <td className="px-3 py-2 text-right text-danger">
                {e.debit ? formatMoney(e.debit, currency) : ''}
              </td>
              <td className="px-3 py-2 text-right text-success">
                {e.credit ? formatMoney(e.credit, currency) : ''}
              </td>
              <td className="px-3 py-2 text-right font-medium">{formatMoney(e.balance, currency)}</td>
            </tr>
          ))}
          <tr className="sticky bottom-0 border-t-2 border-ink bg-surface">
            <td className="px-3 py-2 font-bold" colSpan={3}>Total</td>
            <td className="px-3 py-2 text-right font-bold text-danger">{formatMoney(totalDebit, currency)}</td>
            <td className="px-3 py-2 text-right font-bold text-success">{formatMoney(totalCredit, currency)}</td>
            <td className="px-3 py-2 text-right font-bold">{formatMoney(closing, currency)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    </>
  )
}
