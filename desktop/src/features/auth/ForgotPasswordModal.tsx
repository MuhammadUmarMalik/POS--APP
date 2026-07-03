import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { recoverPasswordSchema, type RecoverPasswordInput } from '../../shared/schemas'
import { Button, Field, Input, Modal, PasswordInput } from '../../components/ui'
import { api } from '../../lib/ipc'
import { toast } from '../../components/ui/toast'

export function ForgotPasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RecoverPasswordInput>({ resolver: zodResolver(recoverPasswordSchema) })

  const onSubmit = handleSubmit(async (values) => {
    try {
      await api('auth:recoverPassword', values)
      toast.success('Password reset — you can sign in now')
      reset()
      onClose()
    } catch (e) {
      setError('recovery_code', { message: (e as Error).message })
    }
  })

  return (
    <Modal open={open} onClose={onClose} title="Forgot password">
      <p className="mb-4 text-sm text-muted">
        Cashiers: ask an administrator to reset your password from Settings → Users.
        Administrators: use the shop recovery code (shown in Settings) to reset any password.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Username" required error={errors.username?.message}>
          <Input {...register('username')} autoFocus />
        </Field>
        <Field label="Recovery code" required error={errors.recovery_code?.message}>
          <Input {...register('recovery_code')} placeholder="e.g. 4F2A9C0B11D3" className="uppercase" />
        </Field>
        <Field label="New password" required error={errors.new_password?.message}>
          <PasswordInput {...register('new_password')} autoComplete="new-password" />
        </Field>
        <div className="flex justify-between">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Reset password
          </Button>
        </div>
      </form>
    </Modal>
  )
}
