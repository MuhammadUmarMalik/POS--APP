import { create } from 'zustand'
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { cn } from '../../lib/utils'

type ToastTone = 'success' | 'error' | 'warning'
interface ToastItem {
  id: number
  tone: ToastTone
  message: string
}

let nextId = 1

const useToastStore = create<{
  toasts: ToastItem[]
  push: (tone: ToastTone, message: string) => void
  remove: (id: number) => void
}>((set) => ({
  toasts: [],
  push: (tone, message) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, tone, message }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3500)
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const toast = {
  success: (m: string) => useToastStore.getState().push('success', m),
  error: (m: string) => useToastStore.getState().push('error', m),
  warning: (m: string) => useToastStore.getState().push('warning', m),
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const remove = useToastStore((s) => s.remove)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => remove(t.id)}
          className={cn(
            'pointer-events-auto flex items-center gap-2 rounded-md px-4 py-3 text-sm font-medium text-white shadow-lg',
            t.tone === 'success' && 'bg-success',
            t.tone === 'error' && 'bg-danger',
            t.tone === 'warning' && 'bg-warning'
          )}
        >
          {t.tone === 'success' && <CheckCircle2 size={16} />}
          {t.tone === 'error' && <XCircle size={16} />}
          {t.tone === 'warning' && <AlertTriangle size={16} />}
          {t.message}
        </button>
      ))}
    </div>
  )
}
