// Small building blocks shared by the report tabs.
import type { ReactNode } from 'react'
import { Card } from '../../components/ui'
import { ExportBar } from '../../components/ExportBar'
import { rangeLabel, rangeScope, type AnySection } from '../../lib/export'
import { cn } from '../../lib/utils'

/**
 * Print / PDF / CSV control for a report view. Every tab describes its tables
 * once as ExportSections and all three outputs are derived from that same
 * description, so the CSV can never disagree with the PDF or the screen.
 *
 * Pass the same `from`/`to` the view queried with — the range ends up in the
 * subtitle, in the filename, and (because the sections hold the already
 * filtered rows) in the data itself.
 */
export function ReportExport({
  module,
  from,
  to,
  scope: scopeProp,
  subtitle: subtitleProp,
  title,
  meta,
  stats,
  sections,
  note,
}: {
  module: string
  from?: string
  to?: string
  /** Filename qualifier for reports with no date range — a party or product name. */
  scope?: string
  subtitle?: string
  title: string
  meta?: [string, string][]
  stats?: { label: string; value: string }[]
  sections: AnySection[]
  note?: string
}) {
  const ranged = from != null && to != null
  const scope = scopeProp ?? (ranged ? rangeScope(from, to) : undefined)
  return (
    <div className="no-print flex justify-end">
      <ExportBar
        module={module}
        scope={scope}
        csv
        buildDoc={() => ({
          module,
          scope,
          title,
          subtitle: subtitleProp ?? (ranged ? rangeLabel(from, to) : undefined),
          meta,
          stats,
          sections,
          note,
        })}
      />
    </div>
  )
}

export function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' }) {
  return (
    <Card>
      <div className="text-xs text-muted">{label}</div>
      <div className={cn('text-2xl font-bold', tone === 'green' && 'text-success', tone === 'red' && 'text-danger')}>
        {value}
      </div>
    </Card>
  )
}

/** Inline segmented control used to switch views inside a report tab. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: [T, string][]
}) {
  return (
    <div className="no-print inline-flex gap-1 rounded-lg border border-line bg-surface p-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium',
            value === v ? 'bg-slate-200 text-ink' : 'text-muted hover:text-ink'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function ReportTable({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-left">
        <thead className="bg-slate-50 text-xs uppercase text-muted">
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </Card>
  )
}

export function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return <th className={cn('px-4 py-3', right && 'text-right')}>{children}</th>
}

export function Td({
  children,
  right,
  className,
  colSpan,
}: {
  children?: ReactNode
  right?: boolean
  className?: string
  colSpan?: number
}) {
  return (
    <td colSpan={colSpan} className={cn('px-4 py-2', right && 'text-right', className)}>
      {children}
    </td>
  )
}
