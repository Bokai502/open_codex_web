import fs from "fs/promises"
import path from "path"
import { randomBytes } from "crypto"

const DEFAULT_FREECAD_WORKSPACE_DIR = path.resolve(process.cwd(), "..", "..", "FreeCAD_data", "v4_data")
const ROOT_CONFIG_JSON = path.resolve(process.cwd(), "..", "..", "config.json")
const DEFAULT_FREECAD_RUNTIME_CONFIG = path.resolve(
  process.cwd(),
  "..",
  "..",
  "..",
  "freecad_skills",
  "freecad-skill",
  "config",
  "freecad_runtime.conf",
)

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

function parseSimpleConfig(raw: string) {
  const config = new Map<string, string>()

  raw.split(/\r?\n/u).forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) return

    const separatorIndex = trimmed.indexOf("=")
    if (separatorIndex <= 0) return

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (key) config.set(key, value)
  })

  return config
}

async function readWorkspaceDirFromRootConfig() {
  try {
    const raw = await fs.readFile(ROOT_CONFIG_JSON, "utf-8")
    if (!raw.trim()) return null

    const parsed = JSON.parse(raw) as {
      FREECAD_WORKSPACE_DIR?: unknown
      freecad?: { workspaceDir?: unknown; workspace_dir?: unknown }
    }

    const candidates = [
      parsed.FREECAD_WORKSPACE_DIR,
      parsed.freecad?.workspaceDir,
      parsed.freecad?.workspace_dir,
    ]

    const workspaceDir = candidates.find(isNonEmptyString)
    return isNonEmptyString(workspaceDir) ? path.resolve(workspaceDir) : null
  } catch {
    return null
  }
}

async function resolveFreecadWorkspaceDir() {
  if (isNonEmptyString(process.env.FREECAD_WORKSPACE_DIR)) {
    return path.resolve(process.env.FREECAD_WORKSPACE_DIR)
  }

  const rootConfigWorkspaceDir = await readWorkspaceDirFromRootConfig()
  if (rootConfigWorkspaceDir) {
    return rootConfigWorkspaceDir
  }

  const runtimeConfigPath = process.env.FREECAD_RUNTIME_CONFIG || DEFAULT_FREECAD_RUNTIME_CONFIG
  try {
    const raw = await fs.readFile(runtimeConfigPath, "utf-8")
    const config = parseSimpleConfig(raw)
    const configuredWorkspaceDir = config.get("FREECAD_WORKSPACE_DIR")
    if (isNonEmptyString(configuredWorkspaceDir)) {
      return path.resolve(configuredWorkspaceDir)
    }
  } catch {
    // Fall back to the local default workspace path below.
  }

  return DEFAULT_FREECAD_WORKSPACE_DIR
}

async function atomicWrite(filePath: string, content: string) {
  const tmp = `${filePath}.${randomBytes(4).toString("hex")}.tmp`
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(tmp, content, "utf-8")
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fs.unlink(tmp).catch(() => {})
    throw err
  }
}

export async function getFreecadProgressPercentagesFile() {
  return path.join(await resolveFreecadWorkspaceDir(), "logs", "progress_percentages.json")
}

export async function initializeFreecadProgressForSession(sessionId: string, force = false) {
  const progressFile = await getFreecadProgressPercentagesFile()

  if (!force) {
    const raw = await fs.readFile(progressFile, "utf-8").catch(() => null)
    if (raw !== null) {
      try {
        const existing = JSON.parse(raw)
        if (existing?.session_id === sessionId) return
      } catch {
        // Replace malformed progress files with a clean session record.
      }
    }
  }

  await atomicWrite(progressFile, JSON.stringify({
    session_id: sessionId,
    thread_id: null,
    turn_id: null,
    tool: null,
    updated_at: null,
    success: null,
    progress_percentages: {},
    output_files: {},
    layout_completion_percent: 0,
    modeling_percent: 0,
    export_file_percent: 0,
  }, null, 2))
}
