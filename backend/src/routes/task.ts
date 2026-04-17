import { FastifyInstance } from "fastify"
import { Codex } from "@openai/codex-sdk"
import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"

export async function taskRoutes(
  fastify: FastifyInstance,
  { config, logger }: { config: AppConfig; logger: Logger }
) {
  fastify.post<{ Body: { prompt: string; threadId?: string | null; enabledSkills?: string[] } }>(
    "/api/run",
    async (req, reply) => {
      const { prompt, threadId, enabledSkills } = req.body
      if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
        return reply.status(400).send({ error: "prompt is required" })
      }

      // 如果指定了 skills，把提示注入到 prompt 前面
      const skillNames = (enabledSkills ?? [])
        .filter(s => typeof s === "string" && s.trim() !== "")
        .map(s => s.trim())
      const finalPrompt = skillNames.length > 0
        ? `Please use the following skills if applicable: ${skillNames.join(", ")}.\n\n${prompt.trim()}`
        : prompt.trim()

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      })

      const ping = setInterval(() => reply.raw.write(": ping\n\n"), 15000)

      const abort = new AbortController()
      req.raw.socket?.on("close", () => abort.abort())

      try {
        const codex = new Codex({
          apiKey: config.openai.apiKey,
          baseUrl: config.openai.baseUrl,
        })

        const threadOptions = {
          ...(config.openai.model ? { model: config.openai.model } : {}),
          workingDirectory: config.codex.workingDirectory,
          approvalPolicy: config.codex.approvalPolicy,
          skipGitRepoCheck: config.codex.skipGitRepoCheck,
          modelReasoningEffort: config.codex.modelReasoningEffort,
          sandboxMode: config.codex.sandboxMode,
        }

        const thread = threadId
          ? codex.resumeThread(threadId, threadOptions)
          : codex.startThread(threadOptions)

        const streamed = await thread.runStreamed(
          finalPrompt,
          { signal: abort.signal }
        )

        for await (const event of streamed.events) {
          if (abort.signal.aborted) break
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          logger.error("codex run failed", {
            err,
            requestBody: { prompt, threadId: threadId ?? null, enabledSkills: skillNames },
          })
          reply.raw.write(
            `data: ${JSON.stringify({
              type: "error",
              message: "服务端发生错误，请查看后端日志 logs/app.log",
            })}\n\n`
          )
        }
      } finally {
        clearInterval(ping)
        reply.raw.end()
      }
    }
  )
}
