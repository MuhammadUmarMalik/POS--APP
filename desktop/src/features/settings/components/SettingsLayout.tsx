import type { ReactNode } from 'react'
import { Card } from '../../../components/ui'
import { cn } from '../../../lib/utils'

export function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-0.5 text-sm text-muted">
          Manage your shop profile, membership, and backup.
        </p>
      </div>
      <div className="space-y-6">{children}</div>
    </div>
  )
}

/** Card with the standard settings-section header. */
export function SettingsSection({
  title,
  description,
  icon,
  actions,
  children,
  className,
}: {
  title: string
  description?: string
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('p-0', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          {icon && (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-muted">
              {icon}
            </div>
          )}
          <div>
            <h2 className="text-lg font-semibold leading-6">{title}</h2>
            {description && <p className="text-xs text-muted">{description}</p>}
          </div>
        </div>
        {actions}
      </div>
      <div className="p-5">{children}</div>
    </Card>
  )
}
