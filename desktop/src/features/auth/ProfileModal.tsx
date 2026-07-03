import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  changePasswordSchema, updateProfileSchema,
  type ChangePasswordInput, type UpdateProfileInput,
} from '../../shared/schemas'
import type { AuthState } from '../../shared/types'
import { useAuth, useSession } from '../../stores/auth'
import { Button, Field, Input, Modal, PasswordInput } from '../../components/ui'
import { api } from '../../lib/ipc'
import { toast } from '../../components/ui/toast'

export function ProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useSession()
  const setState = useAuth((s) => s.setState)
  const [tab, setTab] = useState<'profile' | 'password'>('profile')

  const profileForm = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    values: { name: session?.name ?? '' },
  })
  const passwordForm = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: '', new_password: '' },
  })

  const saveProfile = profileForm.handleSubmit(async (values) => {
    try {
      const state = await api<AuthState>('auth:updateProfile', values)
      setState(state)
      toast.success('Profile updated')
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    }
  })

  const savePassword = passwordForm.handleSubmit(async (values) => {
    try {
      await api('auth:changePassword', values)
      passwordForm.reset()
      toast.success('Password changed')
      onClose()
    } catch (e) {
      passwordForm.setError('current_password', { message: (e as Error).message })
    }
  })

  return (
    <Modal open={open} onClose={onClose} title="My profile">
      <div className="mb-4 flex gap-1 rounded-md bg-slate-100 p-1">
        {(
          [
            ['profile', 'Profile'],
            ['password', 'Change password'],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              tab === t
                ? 'flex-1 rounded bg-surface px-3 py-1.5 text-sm font-medium shadow-sm'
                : 'flex-1 rounded px-3 py-1.5 text-sm font-medium text-muted hover:text-ink'
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'profile' ? (
        <form onSubmit={saveProfile} className="space-y-4">
          <Field label="Username">
            <Input value={session?.username ?? ''} disabled className="bg-slate-50" />
          </Field>
          <Field label="Role">
            <Input value={session?.role ?? ''} disabled className="bg-slate-50 capitalize" />
          </Field>
          <Field label="Display name" required error={profileForm.formState.errors.name?.message}>
            <Input {...profileForm.register('name')} autoFocus />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={profileForm.formState.isSubmitting}>
              Save
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={savePassword} className="space-y-4">
          <Field
            label="Current password"
            required
            error={passwordForm.formState.errors.current_password?.message}
          >
            <PasswordInput {...passwordForm.register('current_password')} autoFocus autoComplete="current-password" />
          </Field>
          <Field
            label="New password"
            required
            error={passwordForm.formState.errors.new_password?.message}
          >
            <PasswordInput {...passwordForm.register('new_password')} autoComplete="new-password" />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={passwordForm.formState.isSubmitting}>
              Change password
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
