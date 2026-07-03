import { ipcRenderer, contextBridge } from 'electron'

contextBridge.exposeInMainWorld('api', {
  invoke: (channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload),
  onPrintDone: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('print:done', listener)
    return () => ipcRenderer.off('print:done', listener)
  },
})
