// Printer & Receipt Settings — the single place these choices are made.
//
// Everything on this screen is saved per shop and read back by every printable
// document in the app through the print settings store, so a change here takes
// effect immediately and everywhere, with no restart.
//
// The one exception is the default printer: printer names are per-machine, so
// that choice is stored locally on this device rather than in the shop record.
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Printer, RotateCcw, TriangleAlert } from 'lucide-react'
import { Button, Field, Input, Select, Spinner } from '../../../components/ui'
import { toast } from '../../../components/ui/toast'
import { usePrintSettings } from '../../../stores/printSettings'
import { DEFAULT_PRINT_SETTINGS } from '../../../shared/printDefaults'
import { printSettingsSchema } from '../../../shared/schemas'
import type { PrintSettingsForm, PrintSettingsInput } from '../../../shared/schemas'
import type { PrintSettings } from '../../../shared/types'
import { isThermal } from '../../../shared/types'
import { SettingsSection } from './SettingsLayout'

const toForm = (s: PrintSettings): PrintSettingsForm => ({ ...s })

export function PrinterReceiptSettings() {
  const settings = usePrintSettings((s) => s.settings)
  const loaded = usePrintSettings((s) => s.loaded)
  const load = usePrintSettings((s) => s.load)
  const save = usePrintSettings((s) => s.save)
  const resetSettings = usePrintSettings((s) => s.reset)
  const printerName = usePrintSettings((s) => s.printerName)
  const setPrinter = usePrintSettings((s) => s.setPrinter)
  const [resetting, setResetting] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<PrintSettingsForm, unknown, PrintSettingsInput>({
    resolver: zodResolver(printSettingsSchema),
    defaultValues: toForm(settings),
  })

  useEffect(() => {
    void load()
  }, [load])

  // The saved settings arrive after the first render, and again after a reset.
  // Re-seeding the form is what makes "reset to defaults" visibly take effect
  // instead of leaving the old values sitting in the inputs.
  useEffect(() => {
    reset(toForm(settings))
  }, [settings, reset])

  const { data: printers, isLoading: printersLoading } = useQuery({
    queryKey: ['printers'],
    queryFn: () => usePrintSettings.getState().listPrinters(),
    staleTime: 30_000,
  })

  const paperSize = watch('paper_size')
  const template = watch('receipt_template')
  const bottomMargin = Number(watch('margin_bottom_mm'))
  const autoPrint = watch('auto_print_on_save')
  const rollPaper = isThermal(paperSize)
  const rollBill = rollPaper || template === 'thermal'

  const onSubmit = handleSubmit(async (values) => {
    try {
      await save(values)
      toast.success('Printer & receipt settings saved')
    } catch (e) {
      toast.error((e as Error).message)
    }
  })

  const onReset = async () => {
    setResetting(true)
    try {
      await resetSettings()
      toast.success('Reset to default settings')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setResetting(false)
    }
  }

  const selected = printers?.find((p) => p.name === printerName)

  return (
    <SettingsSection
      title="Printer & Receipt Settings"
      description="Printer selection, paper size and receipt layout options"
      icon={<Printer size={18} />}
      actions={
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onReset} loading={resetting} disabled={isSubmitting}>
            <RotateCcw size={14} /> Reset to defaults
          </Button>
          <Button size="sm" onClick={onSubmit} loading={isSubmitting} disabled={!isDirty}>
            Save settings
          </Button>
        </div>
      }
    >
      {!loaded ? (
        <Spinner />
      ) : (
        <form onSubmit={onSubmit} className="space-y-7">
          <Group title="Printer">
            <div className="grid gap-5 md:grid-cols-2">
              <Field
                label="Default printer"
                hint={printersLoading ? 'Looking for printers…' : 'Used for automatic and receipt printing on this device.'}
              >
                <Select value={printerName ?? ''} onChange={(e) => setPrinter(e.target.value || null)}>
                  <option value="">System default printer</option>
                  {printers?.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.displayName}
                      {p.isDefault ? ' (system default)' : ''}
                      {p.isVirtual ? ' — saves to a file' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Paper size" error={errors.paper_size?.message}>
                <Select {...register('paper_size')}>
                  <option value="A4">A4</option>
                  <option value="A5">A5</option>
                  <option value="Letter">Letter</option>
                  <option value="Legal">Legal</option>
                  <option value="Tabloid">Tabloid</option>
                  <option value="Thermal80">Thermal 80 mm roll</option>
                  <option value="Thermal58">Thermal 58 mm roll</option>
                </Select>
              </Field>
              <Field label="Layout" hint={rollPaper ? 'Rolls always print upright.' : undefined}>
                <Select {...register('landscape', { setValueAs: (v) => v === 'true' || v === true })} disabled={rollPaper}>
                  <option value="false">Portrait</option>
                  <option value="true">Landscape</option>
                </Select>
              </Field>
              <Field label="Print colour" error={errors.color_mode?.message}>
                <Select {...register('color_mode')}>
                  <option value="color">Full colour</option>
                  <option value="grayscale">Grayscale</option>
                  <option value="bw">Black &amp; white</option>
                </Select>
              </Field>
            </div>

            <div className="mt-5">
              <div className="mb-1.5 text-xs font-medium text-muted">
                Margins (mm){rollPaper && ' — not used on roll paper'}
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MarginField label="Top" error={errors.margin_top_mm?.message}
                  {...register('margin_top_mm', { valueAsNumber: true })} disabled={rollPaper} />
                <MarginField label="Right" error={errors.margin_right_mm?.message}
                  {...register('margin_right_mm', { valueAsNumber: true })} disabled={rollPaper} />
                <MarginField label="Bottom" error={errors.margin_bottom_mm?.message}
                  {...register('margin_bottom_mm', { valueAsNumber: true })} disabled={rollPaper} />
                <MarginField label="Left" error={errors.margin_left_mm?.message}
                  {...register('margin_left_mm', { valueAsNumber: true })} disabled={rollPaper} />
              </div>
            </div>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <Field label="Copies to print by default" error={errors.copies?.message}>
                <Input type="number" min={1} max={10} {...register('copies', { valueAsNumber: true })} />
              </Field>
            </div>

            <div className="mt-5 divide-y divide-line rounded-lg border border-line">
              <Toggle
                {...register('page_numbers')}
                title="Print page numbers"
                description={
                  bottomMargin < 10
                    ? 'Needs a bottom margin of 10 mm or more, and is never printed on roll paper.'
                    : 'Adds "Page 1 of 3" to the footer of multi-page documents.'
                }
              />
              <Toggle
                {...register('auto_print_on_save')}
                title="Print automatically when a sale is saved"
                description="Sends the receipt straight to the printer above, without a print dialog."
              />
            </div>

            {autoPrint && !printerName && !printersLoading && (
              <Warning>
                No default printer is selected, so automatic printing will use whatever Windows
                considers the default — which may prompt to save a file. Choose a printer above.
              </Warning>
            )}
            {autoPrint && selected?.isVirtual && (
              <Warning>
                &ldquo;{selected.displayName}&rdquo; saves to a file rather than printing. Automatic
                printing will ask for a filename in the middle of a sale.
              </Warning>
            )}
          </Group>

          <Group title="Receipt">
            <div className="grid gap-5 md:grid-cols-2">
              <Field
                label="Receipt template"
                hint={
                  template === 'thermal'
                    ? 'A narrow single-column roll receipt, printed on 80 mm unless a roll size is set above.'
                    : template === 'compact'
                      ? 'The full invoice at about half the height — useful for A5 or saving paper.'
                      : 'A full-page invoice with customer block, totals table and signatures.'
                }
              >
                <Select {...register('receipt_template')}>
                  <option value="full">Full invoice</option>
                  <option value="thermal">Thermal receipt</option>
                  <option value="compact">Compact</option>
                </Select>
              </Field>
              <Field label="Currency on documents" hint="Leave blank to use the shop currency.">
                <div className="flex gap-2">
                  <Input placeholder="Rs" className="w-24" {...register('currency_symbol')} />
                  <Select {...register('currency_position')}>
                    <option value="before">Before amount (Rs 1,200)</option>
                    <option value="after">After amount (1,200 Rs)</option>
                  </Select>
                </div>
              </Field>
            </div>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <Field label="Custom header text" error={errors.header_text?.message}>
                <Input placeholder="e.g. Cash Memo" {...register('header_text')} />
              </Field>
              <Field label="Custom footer text" error={errors.footer_text?.message}>
                <Input placeholder="Thank you for your business" {...register('footer_text')} />
              </Field>
            </div>

            <div className="mt-5 divide-y divide-line rounded-lg border border-line">
              <Toggle {...register('show_logo')} title="Show company logo" description="Prints the shop logo set in Shop Profile." />
              <Toggle {...register('show_header')} title="Show company header" description="Shop name, address, phone and NTN." />
              <Toggle {...register('show_prepared_by')} title="Show Prepared By" description="Prints the cashier's name, or a blank line to sign." />
              <Toggle {...register('show_notes')} title="Show Notes and footer text" description="Prints document notes and the footer text above." />
            </div>

            {rollBill && (
              <p className="mt-3 text-xs text-muted">
                Roll receipts re-flow to a single narrow column: wide tables become stacked
                label/value lines, and the logo is scaled to the paper width.
              </p>
            )}
          </Group>

          <p className="text-xs text-muted">
            These settings apply to the whole shop and to every printed document. The default printer
            is remembered for this device only. Defaults:{' '}
            {DEFAULT_PRINT_SETTINGS.paper_size}, {DEFAULT_PRINT_SETTINGS.margin_top_mm} mm margins,
            thermal receipt.
          </p>
          {/* Enter in any field submits, matching the other settings forms. */}
          <button type="submit" className="hidden" />
        </form>
      )}
    </SettingsSection>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  )
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <TriangleAlert size={15} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

const MarginField = ({
  label,
  error,
  ...input
}: { label: string; error?: string } & React.ComponentProps<'input'>) => (
  <Field label={label} error={error}>
    <Input type="number" min={0} max={50} step={1} {...input} />
  </Field>
)

/** Switch styled like the one in App Preferences, driven by an RHF register. */
const Toggle = ({
  title,
  description,
  ...input
}: { title: string; description: string } & React.ComponentProps<'input'>) => (
  <label className="flex cursor-pointer items-center justify-between gap-5 px-4 py-3.5">
    <span>
      <span className="block text-sm font-medium">{title}</span>
      <span className="block text-xs text-muted">{description}</span>
    </span>
    <span className="relative shrink-0">
      <input type="checkbox" className="peer sr-only" {...input} />
      <span className="block h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2" />
      <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
    </span>
  </label>
)
