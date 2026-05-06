import { FastifyInstance } from "fastify"
import fs from "fs/promises"
import path from "path"
import { randomBytes } from "crypto"
import type { Logger } from "../logger.js"
import { initializeFreecadProgressForSession } from "../freecadProgress.js"

const SESSIONS_FILE = path.resolve(process.cwd(), "sessions.json")

type SessionLike = {
  id?: unknown
}

// 先写临时文件再 rename，避免并发写入导致文件截断
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

function extractSessionIds(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set()

  return new Set(
    value
      .map((session: SessionLike) => session?.id)
      .filter((id): id is string => typeof id === "string" && id.trim() !== "")
      .map(id => id.trim()),
  )
}

async function readExistingSessions() {
  try {
    const raw = await fs.readFile(SESSIONS_FILE, "utf-8")
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export async function sessionRoutes(
  fastify: FastifyInstance,
  { logger }: { logger: Logger }
) {
  // GET /api/sessions — 读取所有 sessions
  fastify.get("/api/sessions", async (_req, reply) => {
    try {
      const raw = await fs.readFile(SESSIONS_FILE, "utf-8")
      const data = JSON.parse(raw)
      if (!Array.isArray(data)) return reply.send([])
      return reply.send(data)
    } catch {
      return reply.send([])
    }
  })

  // POST /api/sessions — 覆盖写入所有 sessions（5MB 限制 + 数组校验）
  fastify.post<{ Body: unknown }>(
    "/api/sessions",
    { bodyLimit: 5 * 1024 * 1024 },
    async (req, reply) => {
      if (!Array.isArray(req.body)) {
        return reply.status(400).send({ error: "Body must be a JSON array" })
      }
      if ((req.body as unknown[]).length > 1000) {
        return reply.status(400).send({ error: "Too many sessions (max 1000)" })
      }
      try {
        const beforeSessionIds = extractSessionIds(await readExistingSessions())
        const afterSessionIds = extractSessionIds(req.body)
        const newSessionIds = [...afterSessionIds].filter(id => !beforeSessionIds.has(id))

        for (const sessionId of newSessionIds) {
          await initializeFreecadProgressForSession(sessionId, true)
        }
        await atomicWrite(SESSIONS_FILE, JSON.stringify(req.body, null, 2))
        return reply.status(204).send()
      } catch (err) {
        logger.error("sessions write failed", { err })
        return reply.status(500).send({ error: "internal error, see backend log" })
      }
    }
  )
}
