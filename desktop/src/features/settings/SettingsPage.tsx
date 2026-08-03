import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus, ShieldCheck, Users as UsersIcon, UserX, UserCheck } from 'lucide-react'
import { api } from '../../lib/ipc'
import { useSession } from '../../stores/auth'
import type { User } from '../../shared/types'
import {
  Badge, Button, Field, Input, Modal, PasswordInput, Select, Spinner,
} from '../../components/ui'
import { toast } from '../../components/ui/toast'
import { SettingsLayout, SettingsSection } from './components/SettingsLayout'
import { ShopProfileSettings } from './components/ShopProfileSettings'
import { SubscriptionStatusCard } from './components/SubscriptionStatusCard'
import { GoogleDriveBackupSettings } from './components/GoogleDriveBackupSettings'
import { LocalBackupSettings } from './components/LocalBackupSettings'
import { AutoLocalBackupSettings } from './components/AutoLocalBackupSettings'
import { PrinterReceiptSettings } from './components/PrinterReceiptSettings'
import { AppPreferencesSettings } from './components/AppPreferencesSettings'
import { BatchExpirySettings } from './components/BatchExpirySettings'

export function SettingsPage() {
  return (
    <SettingsLayout>
      <ShopProfileSettings />
      <SubscriptionStatusCard />
      <LocalBackupSettings />
      <AutoLocalBackupSettings />
      <GoogleDriveBackupSettings />
      <PrinterReceiptSettings />
      <BatchExpirySettings />
      <UsersSection />
      <AppPreferencesSettings />
      <SecuritySection />
    </SettingsLayout>
  )
}

/** Security: today just the offline password-recovery code; more to come. */
function SecuritySection() {
  const [code, setCode] = useState<string | null>(null)

  const reveal = async () => {
    try {
      const res = await api<{ recovery_code: string }>('settings:recoveryCode')
      setCode(res.recovery_code)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <SettingsSection
      title="Security"
      description="Password recovery for this device"
      icon={<ShieldCheck size={18} />}
    >
      <p className="mb-4 text-sm text-muted">
        If you forget a password, the &quot;Forgot password?&quot; link on the login screen accepts this
        code. Write it down and keep it somewhere safe — anyone holding it can reset any password.
      </p>
      {code ? (
        <div className="flex items-center gap-3">
          <span className="rounded-md border border-line bg-slate-50 px-4 py-2 font-mono text-lg tracking-widest">
            {code}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setCode(null)}>
            Hide
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={reveal}>
          <KeyRound size={15} /> Reveal recovery code
        </Button>
      )}
    </SettingsSection>
  )
}

function UsersSection() {
  const session = useSession()
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [resetFor, setResetFor] = useState<User | null>(null)

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api<User[]>('users:list'),
  })

  const toggleActive = async (u: User) => {
    try {
      await api('users:setActive', { id: u.id, active: !u.active })
      toast.success(u.active ? `${u.name} deactivated` : `${u.name} activated`)
      void qc.invalidateQueries({ queryKey: ['users'] })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <SettingsSection
      title="Users & Permissions"
      description="Cashier and admin accounts on this device"
      icon={<UsersIcon size={18} />}
      actions={
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus size={14} /> Add user
        </Button>
      }
      className="overflow-hidden"
    >
      {isLoading || !users ? (
        <Spinner />
      ) : (
        <div className="-m-5">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Username</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <td className="px-4 py-2.5 font-medium">
                    {u.name} {u.id === session?.userId && <span className="text-xs text-muted">(you)</span>}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{u.username}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={u.role === 'admin' ? 'blue' : 'slate'}>{u.role}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={u.active ? 'green' : 'red'}>{u.active ? 'Active' : 'Disabled'}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <button
                        title="Reset password"
                        className="rounded p-1.5 text-muted hover:bg-slate-200"
                        onClick={() => setResetFor(u)}
                      >
                        <KeyRound size={15} />
                      </button>
                      {u.id !== session?.userId && (
                        <button
                          title={u.active ? 'Deactivate' : 'Activate'}
                          className="rounded p-1.5 text-muted hover:bg-slate-200"
                          onClick={() => toggleActive(u)}
                        >
                          {u.active ? <UserX size={15} /> : <UserCheck size={15} />}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddUserModal open={addOpen} onClose={() => setAddOpen(false)} />
      {resetFor && <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} />}
    </SettingsSection>
  )
}

function AddUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<{ name: string; username: string; password: string; role: 'admin' | 'cashier' }>({
    defaultValues: { role: 'cashier' },
  })

  const onSubmit = handleSubmit(async (v) => {
    try {
      await api('users:create', v)
      toast.success(`User ${v.username} created`)
      void qc.invalidateQueries({ queryKey: ['users'] })
      reset()
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    }
  })

  return (
    <Modal open={open} onClose={onClose} title="Add user">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" required error={errors.name?.message}>
          <Input {...register('name', { required: 'Required' })} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Username" required error={errors.username?.message}>
            <Input {...register('username', { required: 'Required', minLength: { value: 3, message: 'Min 3 chars' } })} />
          </Field>
          <Field label="Password" required error={errors.password?.message}>
            <PasswordInput {...register('password', { required: 'Required', minLength: { value: 4, message: 'Min 4 chars' } })} />
          </Field>
        </div>
        <Field label="Role" required>
          <Select {...register('role')}>
            <option value="cashier">Cashier — POS and customers only</option>
            <option value="admin">Admin — full access</option>
          </Select>
        </Field>
        <div className="flex justify-between pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={isSubmitting}>Create user</Button>
        </div>
      </form>
    </Modal>
  )
}

function ResetPasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (password.length < 4) return toast.warning('Min 4 characters')
    setSubmitting(true)
    try {
      await api('users:resetPassword', { id: user.id, password })
      toast.success(`Password reset for ${user.username}`)
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Reset password — ${user.name}`}>
      <Field label="New password" required>
        <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </Field>
      <div className="mt-6 flex justify-between">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} loading={submitting}>Reset password</Button>
      </div>
    </Modal>
  )
}
