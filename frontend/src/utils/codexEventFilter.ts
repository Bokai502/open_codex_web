import type { ThreadEvent } from "../types"

function normalizeMessage(message: string | undefined) {
  return (message ?? "").trim().toLowerCase()
}

export function getEventErrorMessage(event: ThreadEvent): string | null {
  if (event.type === "turn.failed" || event.type === "thread_error") {
    return event.error.message ?? null
  }

  if (event.type === "error") {
    return event.message ?? null
  }

  return null
}

export function isTransientReconnectMessage(message: string | undefined) {
  const normalized = normalizeMessage(message)
  if (!normalized) return false

  return (
    normalized.includes("reconnecting...") ||
    normalized.includes("stream disconnected before completion") ||
    normalized.includes("websocket closed by server before response.completed")
  )
}

export function shouldSuppressEvent(event: ThreadEvent) {
  return isTransientReconnectMessage(getEventErrorMessage(event) ?? undefined)
}
