// Restarting the app after its database has been swapped underneath it.
//
// Every restore route ends here so they cannot drift apart: the schema, the
// caches and the open handles all belong to the database that was just
// replaced, and only a fresh process is guaranteed to be looking at the new one.
import { app } from 'electron'
import { closeDb } from '../db'

/** Long enough for the renderer to paint its "restarting" screen first. */
const GRACE_MS = 750

let restarting = false

/**
 * Closes the database, then relaunches.
 *
 * app.exit() skips `before-quit`, so nothing else will close the connection —
 * without this the process dies holding an un-checkpointed WAL and the incoming
 * instance has to recover it before it can show anything.
 */
export function restartAfterRestore() {
  if (restarting) return
  restarting = true
  setTimeout(() => {
    try {
      closeDb()
    } catch {
      // A database that will not close cleanly must not block the restart —
      // SQLite recovers the journal when the next process opens the file.
    }
    app.relaunch()
    app.exit(0)
  }, GRACE_MS)
}

/**
 * Clears the latch. Only the smoke suite needs this: it drives several restores
 * through one process, where the real app would already have exited.
 */
export function clearRestartLatchForSmoke() {
  restarting = false
}
