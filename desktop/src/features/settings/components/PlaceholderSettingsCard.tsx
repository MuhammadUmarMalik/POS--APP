import type { ReactNode } from 'react'
import { Badge, Card } from '../../../components/ui'

export function PlaceholderSettingsCard({
  title,
  description,
  icon,
}: {
  title: string
  description: string
  icon: ReactNode
}) {
  return (
    <Card className="flex items-center gap-3 opacity-75">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-muted">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold">{title}</h2>
        <p className="truncate text-xs text-muted">{description}</p>
      </div>
      <Badge tone="slate">Coming soon</Badge>
    </Card>
  )
}
