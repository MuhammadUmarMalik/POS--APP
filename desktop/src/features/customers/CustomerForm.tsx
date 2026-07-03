import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import { toPaisa, toRupees } from '../../lib/money'
import type { Customer } from '../../shared/types'
import { Button, Field, Input, Modal } from '../../components/ui'
import { toast } from '../../components/ui/toast'

interface FormValues {
  name: string
  phone: string
  credit_limit: number // rupees
}

export function CustomerForm({
  open,
  onClose,
  customer,
}: {
  open: boolean
  onClose: () => void
  customer: Customer | null
}) {
  const qc = useQueryClient()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>()

  useEffect(() => {
    if (!open) return
    reset(
      customer
        ? { name: customer.name, phone: customer.phone ?? '', credit_limit: toRupees(customer.credit_limit) }
        : { name: '', phone: '', credit_limit: 0 }
    )
  }, [open, customer, reset])

  const onSubmit = handleSubmit(async (v) => {
    const payload = {
      name: v.name,
      phone: v.phone || null,
      credit_limit: toPaisa(v.credit_limit) || 0,
    }
    try {
      if (customer) {
        await api('customers:update', { id: customer.id, ...payload })
        toast.success('Customer updated')
      } else {
        await api('customers:create', payload)
        toast.success('Customer added')
      }
      void qc.invalidateQueries({ queryKey: ['customers'] })
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    }
  })

  return (
    <Modal open={open} onClose={onClose} title={customer ? 'Edit customer' : 'Add customer'}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" required error={errors.name?.message}>
          <Input {...register('name', { required: 'Name is required' })} autoFocus />
        </Field>
        <Field label="Phone">
          <Input {...register('phone')} />
        </Field>
        <Field label="Credit limit (0 = unlimited)">
          <Input type="number" step="0.01" min="0" {...register('credit_limit', { valueAsNumber: true })} />
        </Field>
        <div className="flex justify-between pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={isSubmitting}>{customer ? 'Save' : 'Add customer'}</Button>
        </div>
      </form>
    </Modal>
  )
}
