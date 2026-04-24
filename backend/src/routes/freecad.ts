import { FastifyInstance } from "fastify"
import fs from "fs/promises"
import path from "path"

type RegistryIndex = {
  version?: number
  runs?: Record<string, string>
  sessions?: Record<string, string[]>
}

type RunArtifact = {
  kind?: string
  path?: string
  exists?: boolean
}

type RunManifest = {
  version?: number
  run_id?: string
  session_id?: string | null
  created_at?: string
  updated_at?: string
  outputs?: {
    glb_path?: string
  }
  result?: {
    glb_path?: string
    document?: string
  }
  operation?: {
    status?: string
  }
  artifacts?: RunArtifact[]
}

type RenderableModel = {
  sessionId: string | null
  runId: string | null
  createdAt: string | null
  updatedAt: string | null
  documentName: string | null
  glbPath: string
  version: string
}

type RegistryLocation = {
  registryDir: string
  indexFile: string
}

const LEGACY_WORKSPACE_DIR = path.resolve(process.cwd(), "..", "..", "FreeCAD_data")
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
const DEFAULT_GEOMETRY_AFTER_STEM = "geometry_after"
const DEFAULT_GEOMETRY_EDIT_DIR = "02_geometry_edit"
const DEFAULT_ARTIFACT_REGISTRY_DIR = "registry"

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

async function resolveConfiguredWorkspaceDir() {
  if (isNonEmptyString(process.env.FREECAD_WORKSPACE_DIR)) {
    return path.resolve(process.env.FREECAD_WORKSPACE_DIR)
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
    // Fall back to the legacy workspace path below.
  }

  return LEGACY_WORKSPACE_DIR
}

async function resolveRegistryLocations() {
  const workspaceDir = await resolveConfiguredWorkspaceDir()
  const configuredRegistryDir = isNonEmptyString(process.env.FREECAD_ARTIFACT_REGISTRY_DIR)
    ? path.resolve(process.env.FREECAD_ARTIFACT_REGISTRY_DIR)
    : path.join(workspaceDir, DEFAULT_ARTIFACT_REGISTRY_DIR)

  const locations: RegistryLocation[] = [
    {
      registryDir: configuredRegistryDir,
      indexFile: path.join(configuredRegistryDir, "index.json"),
    },
  ]
  const legacyRegistryDir = path.join(LEGACY_WORKSPACE_DIR, DEFAULT_ARTIFACT_REGISTRY_DIR)
  if (legacyRegistryDir !== configuredRegistryDir) {
    locations.push({
      registryDir: legacyRegistryDir,
      indexFile: path.join(legacyRegistryDir, "index.json"),
    })
  }

  return {
    geometryAfterGlbPath: path.join(
      workspaceDir,
      DEFAULT_GEOMETRY_EDIT_DIR,
      `${DEFAULT_GEOMETRY_AFTER_STEM}.glb`,
    ),
    locations,
    workspaceDir,
  }
}

async function readRegistryIndex(location: RegistryLocation) {
  const raw = await fs.readFile(location.indexFile, "utf-8")
  return JSON.parse(raw) as RegistryIndex
}

async function readRunManifest(location: RegistryLocation, relativePath: string) {
  const manifestPath = path.resolve(location.registryDir, relativePath)
  const raw = await fs.readFile(manifestPath, "utf-8")
  return {
    manifest: JSON.parse(raw) as RunManifest,
    manifestPath,
  }
}

async function getFileVersion(filePath: string) {
  const stat = await fs.stat(filePath)
  return {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  }
}

function resolveGlbPath(manifest: RunManifest) {
  if (isNonEmptyString(manifest.outputs?.glb_path)) return manifest.outputs.glb_path
  if (isNonEmptyString(manifest.result?.glb_path)) return manifest.result.glb_path

  const glbArtifact = manifest.artifacts?.find((artifact) =>
    artifact.kind === "glb" && isNonEmptyString(artifact.path),
  )
  return glbArtifact?.path ?? null
}

async function resolveRenderableModelFromManifest(
  manifest: RunManifest,
  sessionId?: string,
  runId?: string,
): Promise<RenderableModel | null> {
  const resolvedRunId = manifest.run_id ?? null
  const resolvedSessionId = manifest.session_id ?? null

  if (isNonEmptyString(runId) && resolvedRunId !== runId) return null
  if (isNonEmptyString(sessionId) && resolvedSessionId !== sessionId) return null
  if (manifest.operation?.status && manifest.operation.status !== "success") return null

  const glbPath = resolveGlbPath(manifest)
  if (!glbPath) return null

  const fileVersion = await getFileVersion(glbPath).catch(() => null)
  if (!fileVersion) return null

  return {
    sessionId: resolvedSessionId,
    runId: resolvedRunId,
    createdAt: manifest.created_at ?? null,
    updatedAt: manifest.updated_at ?? null,
    documentName: manifest.result?.document ?? null,
    glbPath,
    version: [
      resolvedRunId ?? "unknown-run",
      manifest.updated_at ?? "unknown-update",
      glbPath,
      fileVersion.mtimeMs,
      fileVersion.size,
    ].join(":"),
  }
}

function getSortableTimestamp(model: RenderableModel) {
  const timestamp = model.updatedAt ?? model.createdAt
  if (!timestamp) return Number.NEGATIVE_INFINITY
  const parsed = Date.parse(timestamp)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

async function resolveModelFromRegistry(sessionId?: string, runId?: string) {
  const { locations } = await resolveRegistryLocations()

  if (isNonEmptyString(runId)) {
    for (const location of locations) {
      const index = await readRegistryIndex(location).catch(() => null)
      const manifestRef = index?.runs?.[runId]
      if (!manifestRef) continue

      const manifestRecord = await readRunManifest(location, manifestRef).catch(() => null)
      if (!manifestRecord) continue

      const model = await resolveRenderableModelFromManifest(
        manifestRecord.manifest,
        sessionId,
        runId,
      )
      if (model) return model
    }
    return null
  }

  if (isNonEmptyString(sessionId)) {
    for (const location of locations) {
      const index = await readRegistryIndex(location).catch(() => null)
      const sessionRuns = index?.sessions?.[sessionId] ?? []

      for (const manifestRef of [...sessionRuns].reverse()) {
        const manifestRecord = await readRunManifest(location, manifestRef).catch(() => null)
        if (!manifestRecord) continue

        const model = await resolveRenderableModelFromManifest(
          manifestRecord.manifest,
          sessionId,
        )
        if (model) return model
      }
    }
    return null
  }

  const candidates: RenderableModel[] = []
  for (const location of locations) {
    const index = await readRegistryIndex(location).catch(() => null)
    const manifestRefs = Object.values(index?.runs ?? {})

    for (const manifestRef of manifestRefs) {
      const manifestRecord = await readRunManifest(location, manifestRef).catch(() => null)
      if (!manifestRecord) continue

      const model = await resolveRenderableModelFromManifest(manifestRecord.manifest)
      if (model) candidates.push(model)
    }
  }

  candidates.sort((left, right) => getSortableTimestamp(right) - getSortableTimestamp(left))
  return candidates[0] ?? null
}

async function resolveGeometryAfterModel() {
  const { geometryAfterGlbPath } = await resolveRegistryLocations()
  const fileVersion = await getFileVersion(geometryAfterGlbPath).catch(() => null)
  if (!fileVersion) return null

  return {
    sessionId: null,
    runId: null,
    createdAt: null,
    updatedAt: null,
    documentName: DEFAULT_GEOMETRY_AFTER_STEM,
    glbPath: geometryAfterGlbPath,
    version: [
      "workspace-default",
      geometryAfterGlbPath,
      fileVersion.mtimeMs,
      fileVersion.size,
    ].join(":"),
  } satisfies RenderableModel
}

async function resolveModel(sessionId?: string, runId?: string) {
  if (!isNonEmptyString(sessionId) && !isNonEmptyString(runId)) {
    const workspaceModel = await resolveGeometryAfterModel()
    if (workspaceModel) return workspaceModel
  }

  return resolveModelFromRegistry(sessionId, runId)
}

export async function freecadRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { sessionId?: string; runId?: string } }>(
    "/api/freecad/model",
    async (req, reply) => {
      try {
        const model = await resolveModel(req.query.sessionId, req.query.runId)
        if (!model) {
          return reply.status(404).send({ error: "model not found" })
        }

        return reply.send({
          ...model,
          modelUrl: `/api/freecad/model/file?${new URLSearchParams({
            ...(model.sessionId ? { sessionId: model.sessionId } : {}),
            ...(model.runId ? { runId: model.runId } : {}),
            v: model.version,
          }).toString()}`,
        })
      } catch {
        return reply.status(500).send({ error: "failed to resolve freecad model" })
      }
    },
  )

  fastify.get<{ Querystring: { sessionId?: string; runId?: string } }>(
    "/api/freecad/model/file",
    async (req, reply) => {
      try {
        const model = await resolveModel(req.query.sessionId, req.query.runId)
        if (!model) {
          return reply.status(404).send({ error: "model not found" })
        }

        const data = await fs.readFile(model.glbPath)
        reply.header("Content-Type", "model/gltf-binary")
        reply.header("Cache-Control", "no-cache")
        return reply.send(data)
      } catch {
        return reply.status(404).send({ error: "glb file not found" })
      }
    },
  )
}
