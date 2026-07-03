import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Store } from 'lucide-react'
import { setupSchema, type SetupInput } from '../../shared/schemas'
import { useAuth } from '../../stores/auth'
import { Button, Card, Field, Input, PasswordInput } from '../../components/ui'
import { toast } from '../../components/ui/toast'

export function SetupWizard() {
  const setup = useAuth((s) => s.setup)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SetupInput>({
    resolver: zodResolver(setupSchema),
    defaultValues: { currency: 'Rs', taxPercent: 0 },
  })

  const onSubmit = handleSubmit(async (values) => {
    try {
      await setup(values)
      toast.success('Shop created — welcome!')
    } catch (e) {
      toast.error((e as Error).message)
    }
  })

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-lg p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg bg-primary p-2.5 text-white">
            <Store size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Set up your shop</h1>
            <p className="text-muted">One-time setup, works fully offline afterwards.</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Shop name" required error={errors.shopName?.message}>
            <Input {...register('shopName')} placeholder="e.g. Madina General Store" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Currency symbol" required error={errors.currency?.message}>
              <Input {...register('currency')} placeholder="Rs" />
            </Field>
            <Field label="Default tax %" error={errors.taxPercent?.message}>
              <Input
                type="number"
                step="0.01"
                {...register('taxPercent', { valueAsNumber: true })}
              />
            </Field>
          </div>
          <hr className="border-line" />
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Admin account</p>
          <Field label="Your name" required error={errors.adminName?.message}>
            <Input {...register('adminName')} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Username" required error={errors.username?.message}>
              <Input {...register('username')} autoComplete="off" />
            </Field>
            <Field label="Password" required error={errors.password?.message}>
              <PasswordInput {...register('password')} autoComplete="new-password" />
            </Field>
          </div>
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
            Create shop &amp; start
          </Button>
        </form>
      </Card>
    </div>
  )
}
