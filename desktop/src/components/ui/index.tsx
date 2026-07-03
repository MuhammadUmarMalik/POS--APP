// Small UI kit — POS-tuned: big targets, high contrast, keyboard friendly.
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useEffect,
  useState,
} from 'react'
import { Eye, EyeOff, Loader2, X } from 'lucide-react'
import { cn } from '../../lib/utils'

// ---- Button ----
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success'

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant
    size?: 'sm' | 'md' | 'lg'
    loading?: boolean
  }
>(function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' && 'px-3 py-1.5 text-xs',
        size === 'md' && 'px-5 py-2.5',
        size === 'lg' && 'px-6 py-3.5 text-base',
        variant === 'primary' && 'bg-primary text-white hover:bg-primary-hover',
        variant === 'success' && 'bg-success text-white hover:bg-green-700',
        variant === 'secondary' && 'border border-line bg-surface text-ink hover:bg-slate-50',
        variant === 'danger' && 'bg-danger text-white hover:bg-red-700',
        variant === 'ghost' && 'text-muted hover:bg-slate-100 hover:text-ink',
        className
      )}
      {...rest}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  )
})

// ---- Field wrapper ----
export function Field({
  label,
  required,
  error,
  children,
  className,
}: {
  label: string
  required?: boolean
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-xs font-medium text-muted">
        {label} {required && <span className="text-danger">*</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  )
}

// ---- Input ----
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'w-full rounded-md border border-line bg-surface px-3 py-2.5 text-sm',
          'placeholder:text-slate-400',
          'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
          className
        )}
        {...rest}
      />
    )
  }
)

// ---- PasswordInput ----
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>
>(function PasswordInput({ className, ...rest }, ref) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input ref={ref} type={visible ? 'text' : 'password'} className={cn('pr-10', className)} {...rest} />
      <button
        type="button"
        tabIndex={-1}
        aria-label={visible ? 'Hide password' : 'Show password'}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted hover:text-ink"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
})

// ---- Select ----
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'w-full rounded-md border border-line bg-surface px-3 py-2.5 text-sm',
          'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
          className
        )}
        {...rest}
      >
        {children}
      </select>
    )
  }
)

// ---- Badge ----
export function Badge({
  tone,
  children,
}: {
  tone: 'green' | 'amber' | 'red' | 'blue' | 'slate'
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        tone === 'green' && 'bg-green-100 text-green-800',
        tone === 'amber' && 'bg-amber-100 text-amber-800',
        tone === 'red' && 'bg-red-100 text-red-800',
        tone === 'blue' && 'bg-blue-100 text-blue-800',
        tone === 'slate' && 'bg-slate-100 text-slate-700'
      )}
    >
      {children}
    </span>
  )
}

// ---- Modal ----
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        className={cn(
          'max-h-[90vh] w-full overflow-y-auto rounded-lg bg-surface shadow-xl',
          wide ? 'max-w-2xl' : 'max-w-[480px]'
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// ---- Confirm dialog ----
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  loading,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  loading?: boolean
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-muted">{message}</p>
      <div className="mt-6 flex justify-between">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}

// ---- Misc ----
export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <h1 className="text-2xl font-bold">{children}</h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-line bg-surface p-4', className)}>{children}</div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return <div className="py-12 text-center text-muted">{message}</div>
}

export function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 className="animate-spin text-muted" size={28} />
    </div>
  )
}
