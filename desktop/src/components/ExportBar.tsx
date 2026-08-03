// The single Print / PDF / CSV control used by every report and printable
// document. Modules supply a document description; this component owns the
// page-setup dialog, filename convention, async handling and error reporting.
//
// Page setup is pre-filled from the shop's saved Printer & Receipt Settings.
// Changes made here apply to this screen only — a one-off A5 landscape export
// must not quietly become the shop default — unless the user explicitly saves
// them as the new default.
import { useState } from 'react'
import { Download, FileSpreadsheet, Printer, Settings2 } from 'lucide-react'
import { Button, Field, Input, Modal, Select } from './ui'
import { toast } from './ui/toast'
import { useSession } from '../stores/auth'
import { usePrintSettings } from '../stores/printSettings'
import {
  docToHtml,
  exportFileName,
  paperFrom,
  saveCsv,
  savePdf,
  toCsv,
  useDocContext,
  usePrinter,
  type DocContext,
  type ExportDoc,
  type PrintSettings,
} from '../lib/export'

interface ExportBarProps {
  /** PascalCase module id for the filename, e.g. "SalesReport". */
  module: string
  /** Document number or date range for the filename. */
  scope?: string
  /**
   * Builds the document on demand. Deferred so a 1000-row table is only
   * serialised when the user actually exports.
   */
  buildDoc?: () => ExportDoc
  /** Bespoke print layout, used by bills instead of the generic report shell. */
  buildHtml?: (ctx: DocContext) => string
  /** Reports only — bills have no meaningful CSV form. */
  csv?: boolean
  /** Hides everything while the underlying query is still loading. */
  disabled?: boolean
}

type Busy = 'pdf' | 'csv' | 'print' | null

/** Page-setup fields. The receipt-content settings stay in Settings. */
type PageOverride = Partial<
  Pick<
    PrintSettings,
    | 'paper_size'
    | 'landscape'
    | 'margin_top_mm'
    | 'margin_right_mm'
    | 'margin_bottom_mm'
    | 'margin_left_mm'
    | 'color_mode'
    | 'page_numbers'
    | 'copies'
  >
>

export function ExportBar({ module, scope, buildDoc, buildHtml, csv, disabled }: ExportBarProps) {
  const [busy, setBusy] = useState<Busy>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [override, setOverride] = useState<PageOverride>({})
  const ctx = useDocContext(override)
  const { print } = usePrinter()

  const html = (): string => {
    if (buildHtml) return buildHtml(ctx)
    if (!buildDoc) throw new Error('Nothing to export')
    return docToHtml(buildDoc(), ctx)
  }

  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<{ saved?: boolean; path?: string } | void>) => {
    setBusy(kind)
    try {
      const result = await fn()
      if (result && result.saved === false) return // user cancelled the save dialog
      if (result?.path) toast.success(`Saved to ${result.path}`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  // The dialog lets the user pick the printer for this one job, so it is not
  // silenced to the saved device.
  const onPrint = () =>
    run('print', async () => {
      await print(html(), ctx.settings, { silent: false })
    })

  const onPdf = () =>
    run('pdf', () => savePdf(html(), exportFileName(module, scope, 'pdf'), paperFrom(ctx.settings)))

  const onCsv = () => run('csv', () => {
    if (!buildDoc) throw new Error('This document has no CSV form')
    return saveCsv(toCsv(buildDoc()), exportFileName(module, scope, 'csv'))
  })

  const customised = Object.keys(override).length > 0

  return (
    <div className="no-print flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={onPrint} loading={busy === 'print'} disabled={disabled || !!busy}>
        <Printer size={15} /> Print
      </Button>
      <Button variant="secondary" size="sm" onClick={onPdf} loading={busy === 'pdf'} disabled={disabled || !!busy}>
        <Download size={15} /> PDF
      </Button>
      {csv && (
        <Button variant="secondary" size="sm" onClick={onCsv} loading={busy === 'csv'} disabled={disabled || !!busy}>
          <FileSpreadsheet size={15} /> CSV
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setSetupOpen(true)}
        title={customised ? 'Page setup (changed for this screen)' : 'Page setup'}
        aria-label="Page setup"
        className={customised ? 'text-blue-600' : undefined}
      >
        <Settings2 size={15} />
      </Button>
      <PageSetupDialog
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        settings={ctx.settings}
        override={override}
        onChange={setOverride}
      />
    </div>
  )
}

interface PageSetupProps {
  open: boolean
  onClose: () => void
  /** Saved settings with the current override already applied. */
  settings: PrintSettings
  override: PageOverride
  onChange: (next: PageOverride) => void
}

/**
 * Paper size, layout, margins, colour and copies for this screen. Values shown
 * are the shop defaults until the user changes something; "Save as default"
 * writes them back for everyone.
 */
export function PageSetupDialog({ open, onClose, settings, override, onChange }: PageSetupProps) {
  const [saving, setSaving] = useState(false)
  const save = usePrintSettings((s) => s.save)
  const isAdmin = useSession()?.role === 'admin'
  const patch = (p: PageOverride) => onChange({ ...override, ...p })
  const customised = Object.keys(override).length > 0

  const margins = [
    ['margin_top_mm', 'Top'],
    ['margin_right_mm', 'Right'],
    ['margin_bottom_mm', 'Bottom'],
    ['margin_left_mm', 'Left'],
  ] as const

  const saveAsDefault = async () => {
    setSaving(true)
    try {
      await save(settings)
      onChange({}) // the override is now the default; nothing left to override
      toast.success('Saved as the default page setup')
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Page setup">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Paper size">
            <Select
              value={settings.paper_size}
              onChange={(e) => patch({ paper_size: e.target.value as PrintSettings['paper_size'] })}
            >
              <option value="A4">A4</option>
              <option value="A5">A5</option>
              <option value="Letter">Letter</option>
              <option value="Legal">Legal</option>
              <option value="Tabloid">Tabloid</option>
              <option value="Thermal80">Thermal 80 mm</option>
              <option value="Thermal58">Thermal 58 mm</option>
            </Select>
          </Field>
          <Field label="Layout">
            <Select
              value={settings.landscape ? 'landscape' : 'portrait'}
              onChange={(e) => patch({ landscape: e.target.value === 'landscape' })}
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </Select>
          </Field>
          <Field label="Colour mode">
            <Select
              value={settings.color_mode}
              onChange={(e) => patch({ color_mode: e.target.value as PrintSettings['color_mode'] })}
            >
              <option value="color">Full colour</option>
              <option value="grayscale">Grayscale</option>
              <option value="bw">Black &amp; white</option>
            </Select>
          </Field>
          <Field label="Copies">
            <Input
              type="number"
              min={1}
              max={10}
              value={settings.copies}
              onChange={(e) => patch({ copies: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })}
            />
          </Field>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">Margins (mm)</div>
          <div className="grid grid-cols-4 gap-2">
            {margins.map(([key, label]) => (
              <Field key={key} label={label}>
                <Input
                  type="number"
                  min={0}
                  max={50}
                  value={settings[key]}
                  onChange={(e) =>
                    patch({ [key]: Math.min(50, Math.max(0, Number(e.target.value) || 0)) } as PageOverride)
                  }
                />
              </Field>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.page_numbers}
            onChange={(e) => patch({ page_numbers: e.target.checked })}
          />
          Print page numbers
          {settings.margin_bottom_mm < 10 && (
            <span className="text-xs text-muted">(needs a bottom margin of 10 mm or more)</span>
          )}
        </label>

        <p className="text-xs text-muted">
          {customised
            ? 'These changes apply to this screen only until you save them as the default.'
            : 'Showing the shop default from Settings › Printer & Receipt.'}
        </p>

        <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={() => onChange({})} disabled={!customised}>
            Use shop default
          </Button>
          <div className="flex gap-2">
            {isAdmin && (
              <Button variant="secondary" onClick={saveAsDefault} loading={saving} disabled={!customised}>
                Save as default
              </Button>
            )}
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
