# Design System

POS is used for hours daily under time pressure — design priority is **speed, clarity, and low eye strain**, not decoration.

## Design Principles
- Large tap/click targets (cashiers move fast, often on touchscreens)
- High contrast for readability in bright shop lighting
- Minimal clicks to complete a sale (barcode scan → pay should be 2 actions)
- Consistent placement of primary actions (checkout button always same spot)

## Color Palette

| Purpose | Color | Hex |
|---|---|---|
| Primary (brand/actions) | Blue | `#2563EB` |
| Success (completed sale, in-stock) | Green | `#16A34A` |
| Warning (low stock, pending sync) | Amber | `#F59E0B` |
| Danger (delete, void, out-of-stock) | Red | `#DC2626` |
| Background | Off-white | `#F8FAFC` |
| Surface/Cards | White | `#FFFFFF` |
| Text primary | Slate-900 | `#0F172A` |
| Text secondary | Slate-500 | `#64748B` |
| Border | Slate-200 | `#E2E8F0` |

Dark mode (optional, phase 2): invert surfaces to `#0F172A` background, `#1E293B` cards, keep accent colors same.

## Typography
- **Font**: Inter or system UI font (fast render, no external load needed offline)
- **Scale**:
  - Page title: 24px / bold
  - Section header: 18px / semibold
  - Body: 14px / regular
  - Small/labels: 12px / medium
  - POS cart item price: 16px / semibold (needs to be scannable at a glance)

## Spacing
- Base unit: 4px grid (4, 8, 12, 16, 24, 32)
- Card padding: 16px
- Button padding: 12px vertical, 20px horizontal

## Core Components

### Buttons
- Primary: filled blue, white text, rounded-md
- Secondary: outlined, slate border
- Danger: filled red (void/delete actions)
- Icon buttons: for repeated actions (print, edit, delete) in tables

### Product Card / List Item
- Image thumbnail (or category icon fallback), name, price, stock badge
- Stock badge: green (in stock), amber (low stock), red (out of stock)

### Cart Panel (POS Screen)
- Fixed on right side (or bottom on smaller screens)
- Line items: name, qty stepper, price, remove icon
- Sticky footer: subtotal, tax, discount, total, checkout button (largest button on screen)

### Data Tables (Inventory, Sales, Purchases lists)
- Sticky header row
- Row hover highlight
- Inline action icons (view/edit/delete) right-aligned
- Status column uses colored badges (pending/synced/completed/returned)

### Forms
- Label above input (not placeholder-only, for clarity)
- Inline validation errors in red, below field
- Required fields marked with `*`

### Sync Status Indicator
- Small persistent icon in top bar
- States: green dot (synced), amber pulsing (syncing), grey (offline), red (sync failed)
- Tooltip on hover shows last synced time

### Modals
- Used for: add/edit product, payment confirmation, license activation
- Max width 480px, centered, dimmed backdrop
- Confirm action button always bottom-right, cancel bottom-left

## Icons
- Use a consistent icon set (Lucide/Feather) — barcode, printer, box, users, chart, sync, alert-triangle for stock warnings

## Accessibility
- Minimum 4.5:1 contrast for text
- All interactive elements keyboard-navigable (barcode scanner + keyboard shortcuts are primary input, not just mouse)
- Keyboard shortcuts: F2 = new sale, F4 = payment, Esc = cancel/void
