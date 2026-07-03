import { useState } from 'react'
import { ImagePlus, RefreshCw, Trash2 } from 'lucide-react'
import { api } from '../../../lib/ipc'
import { useAuth } from '../../../stores/auth'
import type { AuthState, Shop } from '../../../shared/types'
import { Button, ConfirmDialog } from '../../../components/ui'
import { toast } from '../../../components/ui/toast'

/**
 * Upload / change / remove the shop logo. The file picker, type and 2 MB size
 * validation all run in the main process; the renderer only shows the result.
 */
export function LogoUploader() {
  const shop = useAuth((s) => s.state?.shop)
  const state = useAuth((s) => s.state)
  const setState = useAuth((s) => s.setState)
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const applyShop = (updated: Shop) => {
    if (state) setState({ ...state, shop: updated } as AuthState)
  }

  const upload = async () => {
    setBusy(true)
    try {
      const res = await api<{ saved: boolean; shop?: Shop }>('settings:uploadLogo')
      if (res.saved && res.shop) {
        applyShop(res.shop)
        toast.success('Shop logo updated')
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      const updated = await api<Shop>('settings:removeLogo')
      applyShop(updated)
      setConfirmRemove(false)
      toast.success('Shop logo removed')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const logo = shop?.local_logo_path

  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-muted">Shop logo</span>
      <div className="flex items-center gap-4">
        {logo ? (
          <img
            src={`pos-img://${logo}`}
            alt="Shop logo"
            className="h-20 w-20 rounded-md border border-line bg-white object-contain p-1"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-line bg-slate-50 text-muted">
            <ImagePlus size={22} />
          </div>
        )}
        <div className="space-y-1.5">
          {!logo && <p className="text-sm text-muted">No shop logo uploaded yet.</p>}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={upload} loading={busy}>
              {logo ? <><RefreshCw size={14} /> Change</> : <><ImagePlus size={14} /> Upload Logo</>}
            </Button>
            {logo && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmRemove(true)} disabled={busy}>
                <Trash2 size={14} /> Remove Logo
              </Button>
            )}
          </div>
          <p className="text-xs text-muted">JPG, PNG or WEBP · max 2 MB · 500×500px recommended. Shown on receipts.</p>
        </div>
      </div>
      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={remove}
        title="Remove shop logo?"
        message="The logo will disappear from future receipts. You can upload a new one anytime."
        confirmLabel="Remove"
        danger
        loading={busy}
      />
    </div>
  )
}
