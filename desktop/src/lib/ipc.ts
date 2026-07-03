// Typed bridge to the main process. Throws Error(message) on failure so
// react-query and form handlers can treat it like a normal async API.
export async function api<T>(channel: string, payload?: unknown): Promise<T> {
  const result = await window.api.invoke(channel, payload)
  if (!result.ok) throw new Error(result.error)
  return result.data as T
}
