// Print smoke test. The export harness (`npm run verify:export`) proves the HTML
// each print surface builds is correct; it cannot prove Chromium will render it.
// This pushes every fixture it wrote through the real printToPDF pipeline — the
// same one the Print and Download PDF buttons use — at A4 and both roll widths,
// and fails if any document throws or comes out empty.
//
//   npm run verify:print
import { BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderPdf, type ColorMode, type PaperOptions, type PaperSize } from './services/export'

/** Fixtures are named Surface__Paper.html, matching the export harness. */
const PAPER: Record<string, PaperOptions> = {
  A4: { size: 'A4' },
  Thermal80: { size: 'Thermal80' },
  Thermal58: { size: 'Thermal58' },
}

export async function runPrintSmokeTest(): Promise<number> {
  let failures = 0
  const check = (name: string, cond: boolean, detail?: unknown) => {
    if (cond) console.log(`  ok  ${name}`)
    else {
      failures++
      console.error(`FAIL  ${name}`, detail ?? '')
    }
  }

  // The fixtures live beside the harness that writes them, in the source tree —
  // this test is a developer tool and never ships to a shop.
  const here = path.dirname(fileURLToPath(import.meta.url))
  const dir = path.resolve(here, '..', 'scripts', '.print-fixtures')
  if (!fs.existsSync(dir)) {
    console.error(`No fixtures at ${dir} — run "npm run verify:export" first.`)
    return 1
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).sort()
  check('fixtures were generated', files.length > 0, files.length)

  // Each render destroys its offscreen window; without a window of our own the
  // app would see the last one close and quit mid-run.
  const keepAlive = new BrowserWindow({ show: false })
  try {
    for (const file of files) {
      const [surface, paperName] = path.basename(file, '.html').split('__')
      const paper = PAPER[paperName]
      if (!paper) {
        check(`${file} names a paper size we print on`, false, paperName)
        continue
      }
      const html = fs.readFileSync(path.join(dir, file), 'utf8')
      try {
        const pdf = await renderPdf(html, paper)
        // %PDF- is the file signature; a truncated or empty buffer would still
        // be a Buffer, so check the bytes rather than the type.
        check(
          `${surface} renders on ${paperName} (${Math.round(pdf.length / 1024)} KB)`,
          pdf.length > 1000 && pdf.subarray(0, 5).toString('latin1') === '%PDF-',
          pdf.length
        )
      } catch (err) {
        check(`${surface} renders on ${paperName}`, false, (err as Error).message)
      }
    }

    // Colour mode is applied at render time rather than in the templates, so it
    // needs proving here rather than in the HTML harness.
    const sample = fs.readFileSync(path.join(dir, files[0]), 'utf8')
    for (const color of ['color', 'grayscale', 'bw'] as ColorMode[]) {
      try {
        const pdf = await renderPdf(sample, { size: 'A4' as PaperSize, color })
        check(`colour mode "${color}" renders`, pdf.length > 1000, pdf.length)
      } catch (err) {
        check(`colour mode "${color}" renders`, false, (err as Error).message)
      }
    }

    // Landscape and asymmetric margins are the other two settings the renderer
    // acts on directly.
    try {
      const pdf = await renderPdf(sample, {
        size: 'Legal', landscape: true,
        marginTopMm: 6, marginRightMm: 8, marginBottomMm: 6, marginLeftMm: 8,
      })
      check('landscape Legal with custom margins renders', pdf.length > 1000, pdf.length)
    } catch (err) {
      check('landscape Legal with custom margins renders', false, (err as Error).message)
    }
  } finally {
    if (!keepAlive.isDestroyed()) keepAlive.destroy()
  }

  console.log(
    failures === 0 ? '--- ALL PRINT CHECKS PASSED ---' : `--- ${failures} PRINT FAILURES ---`
  )
  return failures === 0 ? 0 : 1
}
