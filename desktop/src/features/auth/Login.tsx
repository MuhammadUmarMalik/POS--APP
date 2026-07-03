import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Store } from 'lucide-react'
import { loginSchema, type LoginInput } from '../../shared/schemas'
import { useAuth } from '../../stores/auth'
import { Button, Card, Field, Input, PasswordInput } from '../../components/ui'
import { ForgotPasswordModal } from './ForgotPasswordModal'

export function Login() {
  const login = useAuth((s) => s.login)
  const shopName = useAuth((s) => s.state?.shop?.name)
  const [forgotOpen, setForgotOpen] = useState(false)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) })

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values)
    } catch (e) {
      setError('password', { message: (e as Error).message })
    }
  })

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 w-fit rounded-lg bg-primary p-3 text-white">
            <Store size={24} />
          </div>
          <h1 className="text-2xl font-bold">{shopName ?? 'POS Desktop'}</h1>
          <p className="text-muted">Sign in to continue</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Username" required error={errors.username?.message}>
            <Input {...register('username')} autoFocus autoComplete="username" />
          </Field>
          <Field label="Password" required error={errors.password?.message}>
            <PasswordInput {...register('password')} autoComplete="current-password" />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
            Sign in
          </Button>
        </form>
        <button
          onClick={() => setForgotOpen(true)}
          className="mt-3 w-full text-center text-xs text-muted hover:text-primary hover:underline"
        >
          Forgot password?
        </button>
        <ForgotPasswordModal open={forgotOpen} onClose={() => setForgotOpen(false)} />
      </Card>
    </div>
  )
}
