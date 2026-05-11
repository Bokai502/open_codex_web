import type { TFunction } from "i18next"
import type { ThreadEvent, Turn } from "../../types"

export type FreecadProgressResponse = {
  exists?: boolean
  data?: unknown
  source_path?: string | null
  source_version?: string | null
  updated_at?: string | null
}

export type ProgressEntry = {
  fileNames: string[]
  key: string
  label: string
  percent: number
}

const WORKFLOW_PROGRESS_STAGES: ProgressEntry[] = [
  { fileNames: [], key: "layout", label: "workspace.progress.layout", percent: 0 },
  { fileNames: [], key: "modeling", label: "workspace.progress.modeling", percent: 0 },
  { fileNames: [], key: "export_file_percent", label: "workspace.progress.exportFile", percent: 0 },
  { fileNames: [], key: "case_build", label: "workspace.progress.caseBuild", percent: 0 },
  { fileNames: [], key: "simulation_run", label: "workspace.progress.simulationRun", percent: 0 },
  { fileNames: [], key: "field_export", label: "workspace.progress.fieldExport", percent: 0 },
  { fileNames: [], key: "analysis", label: "workspace.progress.analysis", percent: 0 },
  { fileNames: [], key: "suggestion", label: "workspace.progress.suggestion", percent: 0 },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function progressLabel(key: string, t: TFunction) {
  const normalized = key.toLowerCase().replace(/[\s_-]+/gu, "")
  const labels: Record<string, string> = {
    layoutcompletionpercent: t("workspace.progress.layoutComplete"),
    layout: t("workspace.progress.layout"),
    layoutpercent: t("workspace.progress.layout"),
    topology: t("workspace.progress.topology"),
    bom: "BOM",
    geometry: t("workspace.progress.geometry"),
    modeling: t("workspace.progress.modeling"),
    modelingpercent: t("workspace.progress.modeling"),
    model: t("workspace.progress.modeling"),
    build: t("workspace.progress.modeling"),
    assembly: t("workspace.progress.assembly"),
    replacement: t("workspace.progress.replacement"),
    export: t("workspace.progress.export"),
    exportfilepercent: t("workspace.progress.exportFile"),
    exportpercent: t("workspace.progress.export"),
    glb: "GLB",
    step: "STEP",
    preview: t("workspace.progress.preview"),
    simulation: t("workspace.progress.simulationRun"),
    analysis: t("workspace.progress.analysis"),
  }
  return labels[normalized] ?? key
}

function normalizeProgressKey(key: string) {
  const normalized = key.toLowerCase().replace(/[\s_-]+/gu, "")
  const aliases: Record<string, string> = {
    layoutcompletionpercent: "layout",
    layoutpercent: "layout",
    layoutgenerate: "layout",
    layoutgeneratebom: "layout",
    modeling: "modeling",
    modelingpercent: "modeling",
    model: "modeling",
    geometry: "modeling",
    geometryedit: "modeling",
    geometryvalidate: "modeling",
    export: "export_file_percent",
    exportfilepercent: "export_file_percent",
    exportpercent: "export_file_percent",
    casebuild: "case_build",
    simulation: "simulation_run",
    simulationrun: "simulation_run",
    fieldexport: "field_export",
    analysis: "analysis",
    suggestion: "suggestion",
  }
  return aliases[normalized] ?? key
}

export function getWorkflowProgressEntries(progressEntries: ProgressEntry[], t: TFunction) {
  const progressByKey = new Map(progressEntries.map(entry => [normalizeProgressKey(entry.key), entry]))
  return WORKFLOW_PROGRESS_STAGES.map(stage => {
    const progress = progressByKey.get(stage.key)
    const label = t(stage.label)
    return progress ? { ...stage, fileNames: progress.fileNames, label, percent: progress.percent } : { ...stage, label }
  })
}

export function getDisplayFileName(pathValue: string) {
  const normalized = pathValue.replace(/\\/gu, "/")
  return normalized.split("/").pop() || pathValue
}

function isGlbFilePath(pathValue: string) {
  return /\.glb$/iu.test(pathValue.trim())
}

export function getViewerGlbPath(filePaths: string[]) {
  return filePaths.find(isGlbFilePath) ?? null
}

export function getLatestSessionGlbPath(turns: Turn[], currentEvents: ThreadEvent[]) {
  const allEvents = [...turns.flatMap(turn => turn.events), ...currentEvents]
  for (let index = allEvents.length - 1; index >= 0; index -= 1) {
    const event = allEvents[index]
    if (event.type !== "item.completed" || event.item.type !== "file_change") continue
    for (let changeIndex = event.item.changes.length - 1; changeIndex >= 0; changeIndex -= 1) {
      const pathValue = event.item.changes[changeIndex].path
      if (isGlbFilePath(pathValue)) return pathValue
    }
  }
  return null
}

function normalizePercent(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const percent = value <= 1 && value >= 0 ? value * 100 : value
  return Math.max(0, Math.min(100, Math.round(percent)))
}

export function getProgressEntries(data: unknown, t: TFunction): ProgressEntry[] {
  const progressData = isRecord(data) && isRecord(data.progress_percentages)
    ? data.progress_percentages
    : isRecord(data) && isRecord(data.progress)
      ? data.progress
      : data
  const entries: ProgressEntry[] = []
  const outputFilesByKey = getProgressOutputFilesByKey(data)

  if (Array.isArray(progressData)) {
    progressData.forEach((item, index) => {
      if (!isRecord(item)) return
      const key = typeof item.key === "string"
        ? item.key
        : typeof item.name === "string"
          ? item.name
          : typeof item.label === "string"
            ? item.label
            : `step_${index + 1}`
      const value = item.percent ?? item.percentage ?? item.progress ?? item.value
      const percent = normalizePercent(value)
      if (percent === null) return
      entries.push({
        fileNames: outputFilesByKey.get(key) ?? [],
        key,
        label: typeof item.label === "string" ? item.label : progressLabel(key, t),
        percent,
      })
    })
    return entries
  }

  if (!isRecord(progressData)) return entries
  for (const [key, value] of Object.entries(progressData)) {
    if (["files", "key_files", "artifacts", "outputs", "output_files", "progress", "progress_percentages", "updated_at", "tool", "success"].includes(key)) continue
    const percent = normalizePercent(value)
    if (percent === null) continue
    entries.push({
      fileNames: outputFilesByKey.get(key) ?? [],
      key,
      label: progressLabel(key, t),
      percent,
    })
  }
  return entries
}

function getProgressOutputFilesByKey(data: unknown) {
  const files = new Map<string, string[]>()
  if (!isRecord(data) || !isRecord(data.output_files)) return files
  const showFinalOutputs = data.success === true

  for (const [key, value] of Object.entries(data.output_files)) {
    const names: string[] = []
    if (typeof value === "string") {
      if (!showFinalOutputs && ["step", "glb", "replaced_step", "replaced_glb"].includes(key)) continue
      names.push(getDisplayFileName(value))
    } else if (isRecord(value)) {
      if (value.exists !== true) continue
      const pathValue = value.path ?? value.file ?? value.name
      if (typeof pathValue === "string") names.push(getDisplayFileName(pathValue))
    }

    if (names.length === 0) continue
    files.set(key, names)
    if (key === "step" || key === "glb") {
      const exportNames = files.get("export_file_percent") ?? []
      files.set("export_file_percent", [...exportNames, ...names])
    }
  }

  return files
}

export function getProgressFiles(data: unknown) {
  if (!isRecord(data)) return []
  const candidates = [data.files, data.key_files, data.artifacts, data.outputs, data.output_files]
  const paths = new Set<string>()
  const showFinalOutputs = data.success === true

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (typeof item === "string") paths.add(item)
        if (isRecord(item)) {
          if (item.exists === false) continue
          const pathValue = item.path ?? item.file ?? item.name
          if (typeof pathValue === "string") paths.add(pathValue)
        }
      }
    } else if (isRecord(candidate)) {
      for (const [key, value] of Object.entries(candidate)) {
        if (typeof value === "string") {
          if (!showFinalOutputs && ["step", "glb", "replaced_step", "replaced_glb"].includes(key)) continue
          paths.add(value)
        }
        if (isRecord(value)) {
          if (value.exists !== true) continue
          const pathValue = value.path ?? value.file ?? value.name
          if (typeof pathValue === "string") paths.add(pathValue)
        }
      }
    }
  }

  return [...paths].slice(0, 6)
}

export function getFileNames(turns: Turn[], currentEvents: ThreadEvent[]) {
  const names = new Set<string>()
  const allEvents = [...turns.flatMap(turn => turn.events), ...currentEvents]
  for (const event of allEvents) {
    if (event.type !== "item.completed" || event.item.type !== "file_change") continue
    for (const change of event.item.changes) names.add(change.path)
  }
  return [...names].slice(0, 5)
}

export function formatProgressUpdatedAt(progressData: FreecadProgressResponse | null, language: string, t: TFunction) {
  const rawUpdatedAt = progressData?.updated_at ??
    (isRecord(progressData?.data) && typeof progressData.data.updated_at === "string"
      ? progressData.data.updated_at
      : null)
  if (!rawUpdatedAt) return t("workspace.inspector.waitingUpdate")

  const parsed = new Date(rawUpdatedAt)
  if (Number.isNaN(parsed.getTime())) return rawUpdatedAt
  return parsed.toLocaleString(language.startsWith("en") ? "en-US" : "zh-CN")
}
