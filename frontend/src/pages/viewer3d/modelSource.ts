import type { ResolvedModel, ViewerModelSource } from "./types"

export function buildViewerModelSource(): ViewerModelSource | null {
  const params = new URLSearchParams(window.location.search)
  const sessionId = params.get("sessionId")?.trim() ?? ""
  const runId = params.get("runId")?.trim() ?? ""

  const query = new URLSearchParams()
  if (sessionId) query.set("sessionId", sessionId)
  if (runId) query.set("runId", runId)

  return {
    autoRefresh: runId.length === 0,
    lookupUrl: query.size > 0 ? `/api/freecad/model?${query.toString()}` : "/api/freecad/model",
  }
}

export function getModelVersion(resolvedModel: ResolvedModel) {
  return resolvedModel.version ??
    [
      resolvedModel.runId ?? "unknown-run",
      resolvedModel.updatedAt ?? "unknown-update",
      resolvedModel.glbPath,
    ].join(":")
}

export async function fetchResolvedModel(source: ViewerModelSource, signal: AbortSignal) {
  const response = await fetch(source.lookupUrl, { signal, cache: "no-store" })
  if (!response.ok) return null
  return response.json() as Promise<ResolvedModel>
}

export function getModelDisplayName(resolvedModel: ResolvedModel | null) {
  if (!resolvedModel) return "geometry_after.glb"
  if (resolvedModel.documentName?.trim()) return resolvedModel.documentName

  const normalizedPath = resolvedModel.glbPath.replace(/\\/gu, "/")
  return normalizedPath.split("/").pop() || "geometry_after.glb"
}
