import fs from "fs"
import path from "path"
import os from "os"

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface AppConfig {
  openai: {
    apiKey: string
    baseUrl: string
    model: string | null
  }
  codex: {
    modelReasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh"
    approvalPolicy: "never" | "on-request" | "on-failure" | "untrusted"
    sandboxMode: "read-only" | "workspace-write" | "danger-full-access"
    workingDirectory: string
    skipGitRepoCheck: boolean
  }
  server: {
    port: number
    host: string
    corsOrigin: string | string[]
  }
  logging: {
    level: LogLevel
    file: string
    alsoStdout: boolean
  }
}

const CONFIG_FILE = path.resolve(process.cwd(), "config.json")
const EXAMPLE_FILE = path.resolve(process.cwd(), "config.example.json")
const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://localhost:5174",
  "https://127.0.0.1:5174",
]

function die(msg: string): never {
  process.stderr.write(`\n[config] ${msg}\n\n`)
  process.exit(1)
}

function normalizeCorsOrigin(
  value: Partial<AppConfig["server"]>["corsOrigin"],
): string | string[] {
  if (value == null) return DEFAULT_CORS_ORIGINS

  if (typeof value === "string") {
    const origin = value.trim()
    if (!origin) die("server.corsOrigin 不能为空字符串。")
    return origin
  }

  if (Array.isArray(value)) {
    const origins = value
      .map((origin) => (typeof origin === "string" ? origin.trim() : ""))
      .filter((origin) => origin.length > 0)

    if (origins.length === 0) {
      die("server.corsOrigin 数组不能为空。")
    }

    return origins
  }

  die("server.corsOrigin 必须是字符串或字符串数组。")
}

export function loadConfig(): AppConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    die(
      `配置文件不存在: ${CONFIG_FILE}\n` +
      `请复制模板后修改:\n` +
      `  cp ${path.relative(process.cwd(), EXAMPLE_FILE)} config.json\n` +
      `然后把真实的 apiKey / baseUrl / model 填进去再启动。`
    )
  }

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"))
  } catch (err) {
    die(`config.json 不是合法 JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  const cfg = raw as Partial<AppConfig>

  // env 覆盖（方便 CI / 临时切换）
  const envKey = process.env.OPENAI_API_KEY
  const envBase = process.env.OPENAI_BASE_URL

  const apiKey = (envKey ?? cfg.openai?.apiKey ?? "").trim()
  const baseUrl = (envBase ?? cfg.openai?.baseUrl ?? "").trim()
  const model = cfg.openai?.model ?? null

  if (!apiKey) die("openai.apiKey 未设置（或为空）。")
  if (apiKey === "sk-REPLACE-ME") die("openai.apiKey 仍是占位符，请填真实 key。")
  if (!baseUrl) die("openai.baseUrl 未设置（或为空）。")
  try { new URL(baseUrl) } catch { die(`openai.baseUrl 不是合法 URL: ${baseUrl}`) }

  const codex = cfg.codex ?? {} as Partial<AppConfig["codex"]>
  const server = cfg.server ?? {} as Partial<AppConfig["server"]>
  const logging = cfg.logging ?? {} as Partial<AppConfig["logging"]>

  return {
    openai: { apiKey, baseUrl, model },
    codex: {
      modelReasoningEffort: codex.modelReasoningEffort ?? "medium",
      approvalPolicy: codex.approvalPolicy ?? "never",
      sandboxMode: codex.sandboxMode ?? "danger-full-access",
      workingDirectory: codex.workingDirectory || os.homedir(),
      skipGitRepoCheck: codex.skipGitRepoCheck ?? true,
    },
    server: {
      port: server.port ?? 3001,
      host: server.host ?? "0.0.0.0",
      corsOrigin: normalizeCorsOrigin(server.corsOrigin),
    },
    logging: {
      level: logging.level ?? "info",
      file: logging.file ?? "logs/app.log",
      alsoStdout: logging.alsoStdout ?? true,
    },
  }
}
