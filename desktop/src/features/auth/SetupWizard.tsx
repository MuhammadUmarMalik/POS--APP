import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Store } from 'lucide-react'
import { BUSINESS_TYPES, setupSchema, type SetupInput } from '../../shared/schemas'
import { useAuth } from '../../stores/auth'
import { Button, Card, Field, Input, PasswordInput, Select } from '../../components/ui'
import { toast } from '../../components/ui/toast'

export function SetupWizard() {
  const setup = useAuth((s) => s.setup)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SetupInput>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      currency: 'PKR',
      taxPercent: 0,
      receiptFooter: 'Thank you for shopping with us!',
    },
  })

  const onSubmit = handleSubmit(async (values) => {
    try {
      await setup(values)
      toast.success('Shop created — please sign in')
    } catch (e) {
      toast.error((e as Error).message)
    }
  })

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-3xl p-8">
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
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Shop details</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Shop name" required error={errors.shopName?.message}>
              <Input {...register('shopName')} placeholder="e.g. Madina General Store" autoFocus />
            </Field>
            <Field label="Owner name" error={errors.ownerName?.message}>
              <Input {...register('ownerName')} />
            </Field>
            <Field label="Phone" error={errors.phone?.message}>
              <Input {...register('phone')} placeholder="0300-1234567" />
            </Field>
            <Field label="Email" error={errors.email?.message}>
              <Input type="email" {...register('email')} />
            </Field>
          </div>
          <Field label="Address" error={errors.address?.message}>
            <Input {...register('address')} placeholder="Shop #, street, market" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="City" error={errors.city?.message}>
              <Input {...register('city')} />
            </Field>
            <Field label="Business type" error={errors.businessType?.message}>
              <Select {...register('businessType')}>
                <option value="">Select…</option>
                {BUSINESS_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </Select>
            </Field>
            <Field label="Currency symbol" required error={errors.currency?.message}>
              <Input {...register('currency')} placeholder="PKR" />
            </Field>
            <Field label="Default tax %" error={errors.taxPercent?.message}>
              <Input
                type="number"
                step="0.01"
                {...register('taxPercent', { valueAsNumber: true })}
              />
            </Field>
            <Field label="NTN" error={errors.ntn?.message}>
              <Input {...register('ntn')} />
            </Field>
            <Field label="STRN" error={errors.strn?.message}>
              <Input {...register('strn')} />
            </Field>
          </div>
          <Field label="Receipt footer" error={errors.receiptFooter?.message}>
            <Input {...register('receiptFooter')} />
          </Field>
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
            Create shop &amp; continue to login
          </Button>
        </form>
      </Card>
    </div>
  )
}
