// Shared PDF / CSV export pipeline. Every printable document and report in the
// app funnels through here — there is no per-module export code in the main
// process. PDF rendering reuses the exact HTML the on-screen preview builds, so
// the file always matches what the user sees.
import { app, dialog, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { AppError } from './helpers'

export type PaperSize = 'A4' | 'A5' | 'Letter' | 'Legal' | 'Tabloid' | 'Thermal80' | 'Thermal58'
export type ColorMode = 'color' | 'grayscale' | 'bw'

export interface PaperOptions {
  size?: PaperSize
  landscape?: boolean
  /** Page margins in millimetres, per side. */
  marginTopMm?: number
  marginRightMm?: number
  marginBottomMm?: number
  marginLeftMm?: number
  color?: ColorMode
  /** Draw "Page N of M" in the bottom margin. Needs a bottom margin >= 10 mm. */
  pageNumbers?: boolean
}

const MM_PER_INCH = 25.4

/**
 * Thermal rolls are continuous stationery, so there is no standard page height.
 * A tall page keeps a normal receipt on a single sheet; anything longer simply
 * flows onto a second one, which is what the roll does anyway.
 */
const THERMAL_MM: Partial<Record<PaperSize, { width: number; height: number }>> = {
  Thermal80: { width: 80, height: 297 },
  Thermal58: { width: 58, height: 297 },
}

const mmToIn = (mm: number) => mm / MM_PER_INCH

/**
 * Colour mode is applied as a CSS filter because Chromium's printToPDF has no
 * colour switch. Injected rather than baked into every template so the document
 * builders stay colour-agnostic.
 *
 * Black & white pushes contrast hard after desaturating so mid greys resolve to
 * near-black or near-white — the look of a mono laser printer, rather than the
 * flat grey wash that plain grayscale gives.
 */
export function colorCss(color: ColorMode): string {
  if (color === 'grayscale') return 'html { filter: grayscale(1) !important; }'
  if (color === 'bw') return 'html { filter: grayscale(1) contrast(2.4) !important; }'
  return ''
}

/**
 * Renders HTML in an offscreen window and returns the PDF bytes. The window is
 * always destroyed, including on failure, so a broken template cannot leak a
 * hidden process.
 */
export async function renderPdf(html: string, paper: PaperOptions): Promise<Buffer> {
  const size = paper.size ?? 'A4'
  const thermal = THERMAL_MM[size]

  // A receipt roll has no margin to give away — the thermal template supplies
  // its own padding, and honouring a 12 mm page margin on 58 mm stock would
  // leave barely half the width for content.
  const margins = thermal
    ? { top: 0, right: 0, bottom: 0, left: 0 }
    : {
        top: mmToIn(paper.marginTopMm ?? 12),
        right: mmToIn(paper.marginRightMm ?? 12),
        bottom: mmToIn(paper.marginBottomMm ?? 12),
        left: mmToIn(paper.marginLeftMm ?? 12),
      }

  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, javascript: false },
  })
  try {
    const doc = html.replace('</head>', `<style>${colorCss(paper.color ?? 'color')}</style></head>`)
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(doc))

    // Web fonts / images resolve after load; without this the first page can
    // render with fallback metrics and shift the table layout.
    await new Promise((r) => setTimeout(r, 120))

    // Page numbers need room in the bottom margin, and a roll never has any.
    const footer = !thermal && (paper.pageNumbers ?? true) && (paper.marginBottomMm ?? 12) >= 10
    return await win.webContents.printToPDF({
      pageSize: thermal
        ? { width: mmToIn(thermal.width), height: mmToIn(thermal.height) }
        : (size as Exclude<PaperSize, 'Thermal80' | 'Thermal58'>),
      // Rotating a receipt roll is meaningless; ignore the flag for thermal.
      landscape: thermal ? false : (paper.landscape ?? false),
      margins,
      printBackground: true,
      displayHeaderFooter: footer,
      headerTemplate: footer ? '<span></span>' : undefined,
      footerTemplate: footer
        ? '<div style="width:100%;font-size:8px;color:#666;text-align:center;padding:0 10mm;">' +
          'Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>'
        : undefined,
    })
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

/** Strips characters Windows/macOS reject in filenames. */
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120)
}

async function saveAs(
  fileName: string,
  title: string,
  filter: { name: string; extensions: string[] }
): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title,
    defaultPath: path.join(app.getPath('documents'), safeName(fileName)),
    filters: [filter],
  })
  return canceled || !filePath ? null : filePath
}

export interface SaveResult {
  saved: boolean
  path?: string
}

export async function exportPdf(input: {
  html: string
  fileName: string
  paper?: PaperOptions
}): Promise<SaveResult> {
  // Render before prompting: a template crash should surface as an error rather
  // than after the user has already picked a destination.
  const pdf = await renderPdf(input.html, input.paper ?? {})
  const filePath = await saveAs(input.fileName, 'Save PDF', { name: 'PDF document', extensions: ['pdf'] })
  if (!filePath) return { saved: false }
  try {
    fs.writeFileSync(filePath, pdf)
  } catch (err) {
    throw new AppError(`Could not write the PDF: ${(err as Error).message}`)
  }
  return { saved: true, path: filePath }
}

export async function exportCsv(input: { csv: string; fileName: string }): Promise<SaveResult> {
  const filePath = await saveAs(input.fileName, 'Save CSV', { name: 'CSV file', extensions: ['csv'] })
  if (!filePath) return { saved: false }
  try {
    // UTF-8 BOM so Excel detects the encoding and renders non-ASCII shop names.
    fs.writeFileSync(filePath, '﻿' + input.csv, 'utf8')
  } catch (err) {
    throw new AppError(`Could not write the CSV: ${(err as Error).message}`)
  }
  return { saved: true, path: filePath }
}
