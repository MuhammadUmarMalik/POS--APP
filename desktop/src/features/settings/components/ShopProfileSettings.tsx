import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Store, Receipt } from 'lucide-react'
import { api } from '../../../lib/ipc'
import { useAuth } from '../../../stores/auth'
import { BUSINESS_TYPES } from '../../../shared/schemas'
import type { AuthState, Shop } from '../../../shared/types'
import { Button, Field, Input, Modal, Select } from '../../../components/ui'
import { toast } from '../../../components/ui/toast'
import { SettingsSection } from './SettingsLayout'
import { LogoUploader } from './LogoUploader'
import { ReceiptPreview } from './ReceiptPreview'

interface ProfileForm {
  name: string
  owner_name: string
  phone: string
  email: string
  address: string
  city: string
  business_type: string
  currency: string
  tax_percent: number
  ntn: string
  strn: string
  receipt_footer: string
}

const toForm = (shop: Shop | null | undefined): ProfileForm => ({
  name: shop?.name ?? '',
  owner_name: shop?.owner_name ?? '',
  phone: shop?.phone ?? '',
  email: shop?.email ?? '',
  address: shop?.address ?? '',
  city: shop?.city ?? '',
  business_type: shop?.business_type ?? '',
  currency: shop?.currency ?? 'PKR',
  tax_percent: shop?.tax_percent ?? 0,
  ntn: shop?.ntn ?? '',
  strn: shop?.strn ?? '',
  receipt_footer: shop?.receipt_footer ?? 'Thank you for shopping with us!',
})

export function ShopProfileSettings() {
  const shop = useAuth((s) => s.state?.shop)
  const state = useAuth((s) => s.state)
  const setState = useAuth((s) => s.setState)
  const [previewOpen, setPreviewOpen] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileForm>({ defaultValues: toForm(shop) })

  const live = watch()
  const previewData = {
    name: live.name,
    phone: live.phone,
    address: live.address,
    city: live.city,
    currency: live.currency,
    receipt_footer: live.receipt_footer,
    ntn: live.ntn,
    logoFile: shop?.local_logo_path,
  }

  const onSubmit = handleSubmit(async (v) => {
    try {
      const updated = await api<Shop>('settings:updateShop', {
        name: v.name,
        currency: v.currency,
        tax_percent: Number(v.tax_percent) || 0,
        receipt_footer: v.receipt_footer,
        owner_name: v.owner_name || null,
        phone: v.phone || null,
        email: v.email || null,
        address: v.address || null,
        city: v.city || null,
        business_type: v.business_type || null,
        ntn: v.ntn || null,
        strn: v.strn || null,
      })
      if (state) setState({ ...state, shop: updated } as AuthState)
      reset(toForm(updated))
      toast.success('Shop profile saved')
    } catch (e) {
      toast.error((e as Error).message)
    }
  })

  return (
    <SettingsSection
      title="Shop Profile"
      description="Business details shown on receipts and invoices"
      icon={<Store size={18} />}
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <form onSubmit={onSubmit} className="space-y-4 lg:col-span-2">
          <LogoUploader />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Shop name" required error={errors.name?.message}>
              <Input {...register('name', { required: 'Shop name is required' })} />
            </Field>
            <Field label="Owner name">
              <Input {...register('owner_name')} />
            </Field>
            <Field label="Phone" error={errors.phone?.message}>
              <Input
                {...register('phone', {
                  validate: (v) => !v || /^[0-9+\-\s()]{7,20}$/.test(v) || 'Enter a valid phone number',
                })}
                placeholder="0300-1234567"
              />
            </Field>
            <Field label="Email" error={errors.email?.message}>
              <Input
                type="email"
                {...register('email', {
                  validate: (v) => !v || /^\S+@\S+\.\S+$/.test(v) || 'Enter a valid email',
                })}
              />
            </Field>
          </div>
          <Field label="Address">
            <Input {...register('address')} placeholder="Shop #, street, market" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="City">
              <Input {...register('city')} />
            </Field>
            <Field label="Business type">
              <Select {...register('business_type')}>
                <option value="">Select…</option>
                {BUSINESS_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Currency" required>
              <Input {...register('currency', { required: true })} placeholder="PKR" />
            </Field>
            <Field label="Default tax % (informational)">
              <Input type="number" step="0.01" min="0" {...register('tax_percent', { valueAsNumber: true })} />
            </Field>
            <Field label="NTN (National Tax Number)">
              <Input {...register('ntn')} />
            </Field>
            <Field label="STRN (Sales Tax Reg. Number)">
              <Input {...register('strn')} />
            </Field>
          </div>
          <Field label="Receipt footer text">
            <Input {...register('receipt_footer')} placeholder="Thank you for shopping with us!" />
          </Field>
          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" loading={isSubmitting}>Save Changes</Button>
            <Button type="button" variant="secondary" onClick={() => reset(toForm(shop))} disabled={!isDirty}>
              Reset
            </Button>
            <Button type="button" variant="ghost" className="lg:hidden" onClick={() => setPreviewOpen(true)}>
              <Receipt size={15} /> Preview Receipt
            </Button>
          </div>
        </form>

        <div className="hidden lg:block">
          <span className="mb-2 block text-xs font-medium text-muted">Receipt preview (live)</span>
          <ReceiptPreview data={previewData} />
        </div>
      </div>

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Receipt preview">
        <ReceiptPreview data={previewData} />
      </Modal>
    </SettingsSection>
  )
}
