// Full-window "the app is busy" screen.
//
// Matches the static markup in index.html on purpose, so the handover from the
// pre-React startup screen to the first React render is invisible. A bare
// spinner on a white page is indistinguishable from a crash — a shopkeeper
// waiting on a restore has to be told that waiting is the correct thing to do.
interface Props {
  title: string
  detail?: string
}

export function StartupScreen({ title, detail }: Props) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3.5 bg-page p-6 text-center">
      <div className="flex h-13 w-13 items-center justify-center rounded-xl bg-primary text-2xl font-bold text-white">
        P
      </div>
      <div className="text-lg font-semibold">{title}</div>
      {detail && <p className="max-w-sm text-sm text-muted">{detail}</p>}
      <div
        className="h-5.5 w-5.5 animate-spin rounded-full border-[3px] border-line border-t-primary"
        aria-hidden="true"
      />
      <span className="sr-only" role="status" aria-live="polite">
        {title}
      </span>
    </div>
  )
}
