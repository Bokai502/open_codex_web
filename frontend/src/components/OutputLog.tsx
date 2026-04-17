import { memo, useEffect, useMemo, useRef, useState } from "react"
import type { ThreadEvent, ThreadItem, Turn } from "../types"

interface Props {
  turns: Turn[]
  currentPrompt: string
  currentEvents: ThreadEvent[]
  running: boolean
}

interface ItemState {
  item: ThreadItem
  done: boolean
}

// ── 从 events 中提取 item 状态表 ───────────────────────────────
function buildItemStates(events: ThreadEvent[]): { order: string[]; map: Map<string, ItemState> } {
  const map = new Map<string, ItemState>()
  const order: string[] = []
  for (const ev of events) {
    if (ev.type === "item.started" || ev.type === "item.updated") {
      if (!map.has(ev.item.id)) order.push(ev.item.id)
      map.set(ev.item.id, { item: ev.item, done: false })
    } else if (ev.type === "item.completed") {
      if (!map.has(ev.item.id)) order.push(ev.item.id)
      map.set(ev.item.id, { item: ev.item, done: true })
    }
  }
  return { order, map }
}

// ── 光标 ───────────────────────────────────────────────────────
function Cursor() {
  return (
    <span style={{
      display: "inline-block", width: 2, height: 16,
      background: "var(--text)", verticalAlign: "text-bottom",
      marginLeft: 2, borderRadius: 1,
      animation: "blink 1s step-end infinite",
    }} />
  )
}

// ── AI 头像 ────────────────────────────────────────────────────
function AIIcon() {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%",
      background: "var(--ai-icon)", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 1.5C7 1.5 7.8 4.2 9.5 5C11.2 5.8 13 6 13 6C13 6 11.2 6.5 9.5 7.5C7.8 8.5 7 10.5 7 10.5C7 10.5 6.2 8.5 4.5 7.5C2.8 6.5 1 6 1 6C1 6 2.8 5.8 4.5 5C6.2 4.2 7 1.5 7 1.5Z" fill="white" />
      </svg>
    </div>
  )
}

// ── 用户消息 ───────────────────────────────────────────────────
function UserMessage({ text }: { text: string }) {
  return (
    <div style={{
      animation: "fadeIn 0.18s ease forwards",
      paddingBottom: 24, display: "flex", justifyContent: "flex-end",
    }}>
      <div style={{
        maxWidth: "75%",
        background: "var(--bg-3)",
        borderRadius: "18px 18px 4px 18px",
        padding: "10px 16px",
        fontSize: 15, lineHeight: "1.65", color: "var(--text)",
        whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>
        {text}
      </div>
    </div>
  )
}

// ── 图片路径检测 ───────────────────────────────────────────────
// 匹配 Windows 绝对路径中的图片文件，支持 / 和 \ 分隔符
const IMAGE_PATH_RE = /([A-Za-z]:[/\\][\w/\\. -]+\.(?:png|jpg|jpeg|gif|webp|svg))/i

function renderWithImages(text: string): React.ReactNode {
  const parts = text.split(IMAGE_PATH_RE)
  if (parts.length === 1) return text
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const src = `/api/image?path=${encodeURIComponent(part)}`
      return (
        <span key={i} style={{ display: "block", margin: "10px 0" }}>
          <img
            src={src}
            alt={part}
            style={{ maxWidth: "100%", borderRadius: 6, display: "block" }}
          />
          <span style={{
            display: "block", marginTop: 4,
            fontSize: 11, color: "var(--text-3)", fontFamily: "var(--mono)",
            wordBreak: "break-all",
          }}>
            {part}
          </span>
        </span>
      )
    }
    return part || null
  })
}

// ── Agent 消息（直接显示流式文本，打字机效果由 SSE 流本身提供）──
function LiveAgentMessage({ text, done }: { text: string; done: boolean }) {
  return (
    <div style={{ animation: "fadeIn 0.18s ease forwards", paddingBottom: 24 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <AIIcon />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, marginBottom: 6,
            color: done ? "var(--text)" : "var(--text-2)",
            transition: "color 0.3s",
          }}>AI</div>
          <div style={{
            fontSize: 15, lineHeight: "1.78", color: "var(--text)",
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {renderWithImages(text)}{!done && <Cursor />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Agent 消息（静态，用于历史轮）─────────────────────────────
function StaticAgentMessage({ text }: { text: string }) {
  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <AIIcon />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>AI</div>
          <div style={{
            fontSize: 15, lineHeight: "1.78", color: "var(--text)",
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {renderWithImages(text)}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Reasoning（直接显示流式文本）──────────────────────────────
function LiveReasoningBlock({ text, done }: { text: string; done: boolean }) {
  const [open, setOpen] = useState(true)
  return <ReasoningCard text={text} done={done} open={open} onToggle={() => setOpen(o => !o)} />
}

// ── Reasoning（静态，默认折叠）────────────────────────────────
function StaticReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return <ReasoningCard text={text} done open={open} onToggle={() => setOpen(o => !o)} />
}

function ReasoningCard({ text, done, open, onToggle }: {
  text: string; done: boolean; open: boolean; onToggle: () => void
}) {
  return (
    <div style={{ paddingBottom: 16, paddingLeft: 42 }}>
      <div style={{
        border: "1px solid var(--border)", borderRadius: 8,
        overflow: "hidden", background: "var(--bg-2)",
      }}>
        <button onClick={onToggle} style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "9px 14px", background: "transparent", border: "none",
          cursor: "pointer",
          borderBottom: open ? "1px solid var(--border)" : "none", textAlign: "left",
        }}>
          <span style={{ fontSize: 13, color: "var(--text-2)" }}>{open ? "▾" : "▸"}</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)" }}>Thinking</span>
          {!done && (
            <span style={{ fontSize: 12, color: "var(--text-3)", animation: "blink 1.2s step-end infinite" }}>
              •••
            </span>
          )}
        </button>
        {open && (
          <div style={{
            padding: "10px 14px", fontSize: 13, lineHeight: "1.7",
            color: "var(--text-2)", whiteSpace: "pre-wrap",
            wordBreak: "break-word", fontStyle: "italic",
          }}>
            {text}{!done && <Cursor />}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 命令块（通用）─────────────────────────────────────────────
function CommandBlock({ item, done }: {
  item: Extract<ThreadItem, { type: "command_execution" }>
  done: boolean
}) {
  const [open, setOpen] = useState(false)
  const failed = item.exit_code != null && item.exit_code !== 0
  const hasOutput = !!item.aggregated_output
  return (
    <div style={{ paddingBottom: 14, paddingLeft: 42 }}>
      <div style={{ borderRadius: 8, overflow: "hidden", background: "var(--code-bg)", fontSize: 13 }}>
        <button onClick={() => hasOutput && setOpen(o => !o)} style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "8px 14px", background: "var(--code-header)",
          borderBottom: open ? "1px solid rgba(255,255,255,0.06)" : "none",
          border: "none", cursor: hasOutput ? "pointer" : "default", textAlign: "left",
        }}>
          <span style={{ fontSize: 13, color: "var(--code-dim)", width: 10, flexShrink: 0 }}>
            {hasOutput ? (open ? "▾" : "▸") : ""}
          </span>
          <span style={{ fontFamily: "var(--mono)", color: "var(--code-dim)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>shell</span>
          <span style={{ fontFamily: "var(--mono)", color: "rgba(255,255,255,0.75)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.command}
          </span>
          {!done && (
            <span style={{ fontSize: 11, color: "var(--amber)", fontFamily: "var(--mono)", animation: "pulse 1.2s ease-in-out infinite" }}>running</span>
          )}
          {item.exit_code != null && (
            <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: failed ? "#f87171" : "#34d399" }}>
              {item.status === "declined" ? "blocked" : `exit ${item.exit_code}`}
            </span>
          )}
        </button>
        {open && hasOutput && (
          <pre style={{
            margin: 0, padding: "12px 14px",
            fontFamily: "var(--mono)", fontSize: "12.5px", lineHeight: "1.65",
            color: failed ? "#fca5a5" : "var(--code-text)",
            whiteSpace: "pre-wrap", wordBreak: "break-all",
            maxHeight: 300, overflowY: "auto",
          }}>
            {item.aggregated_output}
          </pre>
        )}
      </div>
    </div>
  )
}

// ── 文件变更 ───────────────────────────────────────────────────
function FileChanges({ item }: { item: Extract<ThreadItem, { type: "file_change" }> }) {
  if (!item.changes?.length) return null
  return (
    <div style={{ paddingBottom: 14, paddingLeft: 42 }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--bg-2)" }}>
        <div style={{ padding: "7px 14px", fontSize: 12, fontWeight: 600, color: "var(--text-2)", borderBottom: "1px solid var(--border)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          File changes
        </div>
        <div style={{ padding: "8px 14px" }}>
          {item.changes.map((c, i) => {
            const color = c.kind === "add" ? "var(--green)" : c.kind === "delete" ? "var(--red)" : "var(--blue)"
            const sym   = c.kind === "add" ? "+" : c.kind === "delete" ? "−" : "~"
            return (
              <div key={i} style={{ display: "flex", gap: 10, padding: "2px 0", fontFamily: "var(--mono)", fontSize: 13 }}>
                <span style={{ color, fontWeight: 700, width: 12, textAlign: "center", flexShrink: 0 }}>{sym}</span>
                <span style={{ color: "var(--text-2)" }}>{c.path}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Web Search ─────────────────────────────────────────────────
function WebSearch({ query }: { query: string }) {
  return (
    <div style={{ paddingBottom: 12, paddingLeft: 42, display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-2)" }}>
      <span>🔍</span>
      Searching <em style={{ fontStyle: "normal", color: "var(--text)" }}>"{query}"</em>
    </div>
  )
}

// ── 当前轮 item（带动画）──────────────────────────────────────
function LiveItemView({ state }: { state: ItemState }) {
  const { item, done } = state
  if (item.type === "agent_message")     return <LiveAgentMessage text={item.text} done={done} />
  if (item.type === "reasoning")         return <LiveReasoningBlock text={item.text} done={done} />
  if (item.type === "command_execution") return <CommandBlock item={item} done={done} />
  if (item.type === "file_change")       return <FileChanges item={item} />
  if (item.type === "web_search")        return <WebSearch query={item.query} />
  return null
}

// ── 历史轮 item（静态）────────────────────────────────────────
function StaticItemView({ item }: { item: ThreadItem }) {
  if (item.type === "agent_message")     return <StaticAgentMessage text={item.text} />
  if (item.type === "reasoning")         return <StaticReasoningBlock text={item.text} />
  if (item.type === "command_execution") return <CommandBlock item={item} done />
  if (item.type === "file_change")       return <FileChanges item={item} />
  if (item.type === "web_search")        return <WebSearch query={item.query} />
  return null
}

// ── 历史轮完整渲染（memo：历史 turn 不变则跳过重渲染）──────────
const HistoryTurn = memo(function HistoryTurn({ turn }: { turn: Turn }) {
  const { order, map } = useMemo(() => buildItemStates(turn.events), [turn.events])
  return (
    <>
      <UserMessage text={turn.userPrompt} />
      {order.map(id => {
        const state = map.get(id)!
        return <StaticItemView key={id} item={state.item} />
      })}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        margin: "4px 0 24px", opacity: 0.3,
      }}>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>
    </>
  )
})

// ── 主组件 ────────────────────────────────────────────────────
export function OutputLog({ turns, currentPrompt, currentEvents, running }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  // RAF ref：确保每帧最多触发一次滚动，避免密集事件流造成滚动抖动
  const scrollRafRef = useRef<number | null>(null)
  // Dev render counter
  const renderCountRef = useRef(0)

  if (import.meta.env.DEV) {
    renderCountRef.current += 1
    console.log(`[OutputLog] render #${renderCountRef.current}  events=${currentEvents.length}  turns=${turns.length}`)
  }

  useEffect(() => {
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current)
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    })
  }, [turns.length, currentEvents.length])

  // useMemo：仅在 currentEvents 引用变化（批量 flush 后）时重新计算
  const { order, map } = useMemo(() => {
    const t0 = performance.now()
    const result = buildItemStates(currentEvents)
    if (import.meta.env.DEV) {
      const ms = (performance.now() - t0).toFixed(2)
      if (Number(ms) > 1) console.log(`[buildItemStates] ${ms}ms for ${currentEvents.length} events`)
    }
    return result
  }, [currentEvents])

  const isTurnStarted = currentEvents.some(ev => ev.type === "turn.started")
  const isDone        = currentEvents.some(ev => ev.type === "turn.completed")
  const errorEv       = currentEvents.find(ev => ev.type === "turn.failed" || ev.type === "error")
  const isEmpty       = turns.length === 0 && !currentPrompt && !running

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "var(--bg)" }}>
      <div style={{
        maxWidth: "var(--content-width)",
        margin: "0 auto",
        padding: "32px var(--content-px) 8px",
      }}>

        {/* 空状态 */}
        {isEmpty && (
          <div style={{
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            minHeight: "50vh", gap: 12, textAlign: "center",
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: "50%",
              background: "var(--ai-icon)",
              display: "flex", alignItems: "center", justifyContent: "center",
              marginBottom: 4,
            }}>
              <svg width="22" height="22" viewBox="0 0 14 14" fill="none">
                <path d="M7 1.5C7 1.5 7.8 4.2 9.5 5C11.2 5.8 13 6 13 6C13 6 11.2 6.5 9.5 7.5C7.8 8.5 7 10.5 7 10.5C7 10.5 6.2 8.5 4.5 7.5C2.8 6.5 1 6 1 6C1 6 2.8 5.8 4.5 5C6.2 4.2 7 1.5 7 1.5Z" fill="white" />
              </svg>
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
              How can I help you today?
            </div>
          </div>
        )}

        {/* 历史轮次 */}
        {turns.map(turn => (
          <HistoryTurn key={turn.id} turn={turn} />
        ))}

        {/* 当前轮用户消息 */}
        {currentPrompt && <UserMessage text={currentPrompt} />}

        {/* 初始化点动画 */}
        {isTurnStarted && !isDone && order.length === 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: 14,
            animation: "fadeIn 0.18s ease forwards", paddingBottom: 24,
          }}>
            <AIIcon />
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: "var(--text-3)",
                  animation: `pulse 1.2s ease-in-out ${i * 0.18}s infinite`,
                }} />
              ))}
            </div>
          </div>
        )}

        {/* 当前轮动态 items */}
        {order.map(id => (
          <LiveItemView key={id} state={map.get(id)!} />
        ))}

        {/* 错误 */}
        {errorEv && (
          <div style={{
            animation: "fadeIn 0.18s ease forwards",
            display: "flex", gap: 10, alignItems: "flex-start",
            padding: "12px 16px",
            background: "#fef2f2", border: "1px solid #fecaca",
            borderRadius: 8, color: "var(--red)",
            fontSize: 14, lineHeight: "1.6",
          }}>
            <span>⚠</span>
            <span>
              {"error" in errorEv
                ? (errorEv.error as { message: string }).message
                : "message" in errorEv
                ? (errorEv as { message: string }).message
                : "Unknown error"}
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
