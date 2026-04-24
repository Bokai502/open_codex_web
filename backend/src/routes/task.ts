import { FastifyInstance } from "fastify"
import { Codex } from "@openai/codex-sdk"
import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"

const ASK_USER_PROTOCOL = [
  "You can ask the user for one missing piece of information through the application's ask-user-question capability.",
  "Use it only when a required detail is missing and you cannot proceed safely or accurately without it.",
  "When you need that capability, respond with exactly this XML block and nothing else:",
  "<ask-user-question>",
  "<question>your concise question here</question>",
  "<option>first short option</option>",
  "<option>second short option</option>",
  "<option>third short option</option>",
  "</ask-user-question>",
  "Rules:",
  "- Ask exactly one concise question.",
  "- Include 2 or 3 short, mutually exclusive <option> entries whenever possible.",
  "- Do not include an \"Other\" option. The UI will provide a free-text Other field automatically.",
  "- Do not add explanations, markdown fences, or any other text outside the XML block.",
  "- Do not guess the missing detail if it is necessary.",
].join("\n")

const ASK_USER_TAG_START = /^\s*<ask-user-question>/i
const ASK_USER_BLOCK_RE = /^\s*<ask-user-question>\s*([\s\S]*?)\s*<\/ask-user-question>\s*$/i
const ASK_USER_QUESTION_RE = /<question>\s*([\s\S]*?)\s*<\/question>/i
const ASK_USER_OPTION_RE = /<option>\s*([\s\S]*?)\s*<\/option>/gi

interface AskUserPayload {
  question: string
  options: string[]
}

interface RunContext {
  sessionId: string
  threadId: string | null
  turnId: string
}

function buildPrompt(prompt: string, skillNames: string[], context: RunContext) {
  const skillPrefix = skillNames.length > 0
    ? `Please use the following skills if applicable: ${skillNames.join(", ")}.\n\n`
    : ""
  const executionContext = [
    "Execution context:",
    `- session_id: ${context.sessionId}`,
    `- thread_id: ${context.threadId ?? "null"}`,
    `- turn_id: ${context.turnId}`,
    "",
    "When invoking any freecad-* CLI command, pass these values through environment variables:",
    `- FREECAD_SESSION_ID=${context.sessionId}`,
    `- FREECAD_THREAD_ID=${context.threadId ?? ""}`,
    `- FREECAD_TURN_ID=${context.turnId}`,
    "- FREECAD_CALLER=open_codex_web",
    "- FREECAD_AGENT_NAME=codex",
  ].join("\n")
  return `${ASK_USER_PROTOCOL}\n\n${skillPrefix}${executionContext}\n\n${prompt.trim()}`
}

function normalizeXmlText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function extractAskUserPayload(text: string): AskUserPayload | null {
  const match = text.match(ASK_USER_BLOCK_RE)
  if (!match) return null
  const body = match[1]
  const questionMatch = body.match(ASK_USER_QUESTION_RE)
  const question = questionMatch
    ? normalizeXmlText(questionMatch[1])
    : normalizeXmlText(body.replace(/<[^>]+>/g, " "))

  if (!question) return null

  const options = Array.from(body.matchAll(ASK_USER_OPTION_RE))
    .map(optionMatch => normalizeXmlText(optionMatch[1]))
    .filter(Boolean)
    .filter((option, index, all) => all.indexOf(option) === index)
    .slice(0, 3)

  return { question, options }
}

export async function taskRoutes(
  fastify: FastifyInstance,
  { config, logger }: { config: AppConfig; logger: Logger }
) {
  fastify.post<{ Body: { prompt: string; sessionId?: string | null; threadId?: string | null; turnId?: string | null; enabledSkills?: string[] } }>(
    "/api/run",
    async (req, reply) => {
      const { prompt, sessionId, threadId, turnId, enabledSkills } = req.body
      if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
        return reply.status(400).send({ error: "prompt is required" })
      }
      if (!sessionId || typeof sessionId !== "string" || sessionId.trim() === "") {
        return reply.status(400).send({ error: "sessionId is required" })
      }
      if (!turnId || typeof turnId !== "string" || turnId.trim() === "") {
        return reply.status(400).send({ error: "turnId is required" })
      }

      // 如果指定了 skills，把提示注入到 prompt 前面
      const skillNames = (enabledSkills ?? [])
        .filter(s => typeof s === "string" && s.trim() !== "")
        .map(s => s.trim())
      const finalPrompt = buildPrompt(prompt, skillNames, {
        sessionId: sessionId.trim(),
        threadId: typeof threadId === "string" && threadId.trim() !== "" ? threadId.trim() : null,
        turnId: turnId.trim(),
      })

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

        const suppressedAgentMessageIds = new Set<string>()

        for await (const event of streamed.events) {
          if (abort.signal.aborted) break

          if (
            (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") &&
            event.item.type === "agent_message"
          ) {
            if (event.type === "item.started" && event.item.text.trim() === "") {
              continue
            }

            const askUser = extractAskUserPayload(event.item.text)

            if (askUser) {
              suppressedAgentMessageIds.add(event.item.id)
              if (event.type === "item.completed") {
                reply.raw.write(`data: ${JSON.stringify({
                  type: "item.completed",
                  item: {
                    id: `ask_user:${event.item.id}`,
                    type: "ask_user",
                    question: askUser.question,
                    options: askUser.options,
                  },
                })}\n\n`)
              }
              continue
            }

            if (suppressedAgentMessageIds.has(event.item.id)) {
              if (event.type === "item.completed") {
                suppressedAgentMessageIds.delete(event.item.id)
                reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
              }
              continue
            }

            if (event.type !== "item.completed" && ASK_USER_TAG_START.test(event.item.text)) {
              suppressedAgentMessageIds.add(event.item.id)
              continue
            }
          }

          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          logger.error("codex run failed", {
            err,
            requestBody: {
              prompt,
              sessionId: sessionId ?? null,
              threadId: threadId ?? null,
              turnId: turnId ?? null,
              enabledSkills: skillNames,
            },
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
