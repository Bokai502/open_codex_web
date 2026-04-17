import { useState, useRef, useEffect, useCallback } from "react"
import { Sidebar } from "./components/Sidebar"
import { TaskInput } from "./components/TaskInput"
import { OutputLog } from "./components/OutputLog"
import { useCodexStream } from "./hooks/useTaskStream"
import type { ThreadEvent, Turn, Session } from "./types"

// ── helpers ──────────────────────────────────────────────────────────
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

// localStorage 作为即时读取的缓存层（同步，避免白屏）
const STORAGE_KEY = "codex_sessions"

function lsLoad(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Session[]) : []
  } catch {
    return []
  }
}

function lsSave(sessions: Session[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch { /* ignore quota errors */ }
}

// 后端 sessions.json 作为持久化主存储
async function apiLoad(): Promise<Session[]> {
  try {
    const res = await fetch("/api/sessions")
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? (data as Session[]) : []
  } catch {
    return []
  }
}

// ── App ───────────────────────────────────────────────────────────────
export default function App() {
  // 初始从 localStorage 读（同步，避免白屏），再用后端数据覆盖
  const [sessions, setSessions] = useState<Session[]>(() => lsLoad())
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [currentPrompt, setCurrentPrompt] = useState("")
  const [currentEvents, setCurrentEvents] = useState<ThreadEvent[]>([])
  const [running, setRunning] = useState(false)

  // Refs for use inside async callbacks (avoid stale closures)
  const currentEventsRef = useRef<ThreadEvent[]>([])
  const currentPromptRef = useRef("")
  const activeSessionIdRef = useRef<string | null>(null)
  // 始终持有最新 sessions，供 beforeunload 等非响应式回调使用
  const sessionsRef = useRef<Session[]>(sessions)

  // 防抖 timer 放在 ref 里，避免模块级变量在 StrictMode 双挂载时共享
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 批量合并 SSE 事件，每 80ms 统一触发一次 setCurrentEvents，减少重渲染次数
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 标记是否为首次从后端加载，跳过首次加载触发的冗余 POST
  const isFirstLoadRef = useRef(true)

  const { run, abort } = useCodexStream()

  // Keep activeSessionIdRef in sync with state
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  // sessionsRef 始终跟随最新 sessions 状态
  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  // 启动时从后端加载 session 元数据，与 localStorage 合并后恢复完整历史
  // 后端只存元数据（无 turns），turns 仅保存在 localStorage 中，避免文件膨胀
  useEffect(() => {
    apiLoad().then(lightSessions => {
      if (lightSessions.length === 0) return
      const lsSessions = lsLoad()
      // 将 localStorage 中的 turns 重新附加到后端返回的 session 上
      const merged = lightSessions.map(s => ({
        ...s,
        turns: lsSessions.find(ls => ls.id === s.id)?.turns ?? [],
      }))
      // 保留尚未同步到后端的 localStorage session（如刷新前 debounce 未触发的新 session）
      const lsOnly = lsSessions.filter(ls => !lightSessions.find(s => s.id === ls.id))
      const all = [...merged, ...lsOnly]
      isFirstLoadRef.current = true
      setSessions(all)
      lsSave(all)
    })
  }, [])

  // sessions 变化时同步写入 localStorage + 后端（跳过首次后端覆盖触发的冗余写）
  // 后端只保存元数据（去掉 turns），保持 sessions.json 体积小
  const apiSave = useCallback((sessions: Session[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      const metadata = sessions.map(({ turns: _turns, ...rest }) => rest)
      fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata),
      }).catch(() => { /* ignore network errors */ })
    }, 300)
  }, [])

  useEffect(() => {
    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false
      return
    }
    lsSave(sessions)
    apiSave(sessions)
  }, [sessions, apiSave])

  // 页面卸载前强制刷新：取消 debounce，立即用 sendBeacon 写入后端
  // 解决"刷新后少一个 session"问题（debounce 300ms 内刷新会丢失最新变更）
  useEffect(() => {
    const flush = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      const current = sessionsRef.current
      lsSave(current)
      const metadata = current.map(({ turns: _turns, ...rest }) => rest)
      navigator.sendBeacon(
        "/api/sessions",
        new Blob([JSON.stringify(metadata)], { type: "application/json" })
      )
    }
    window.addEventListener("beforeunload", flush)
    return () => window.removeEventListener("beforeunload", flush)
  }, [])

  // ── derived state ──────────────────────────────────────────────────
  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null
  const turns: Turn[] = activeSession?.turns ?? []

  // ── session management ─────────────────────────────────────────────
  const handleNew = useCallback(() => {
    if (batchTimerRef.current) { clearTimeout(batchTimerRef.current); batchTimerRef.current = null }
    setActiveSessionId(null)
    activeSessionIdRef.current = null
    setCurrentPrompt("")
    setCurrentEvents([])
    currentEventsRef.current = []
  }, [])

  const handleSelect = useCallback((id: string) => {
    if (running) return
    if (batchTimerRef.current) { clearTimeout(batchTimerRef.current); batchTimerRef.current = null }
    setActiveSessionId(id)
    activeSessionIdRef.current = id
    setCurrentPrompt("")
    setCurrentEvents([])
    currentEventsRef.current = []
  }, [running])

  const handleDelete = useCallback((id: string) => {
    // 如果删除的是当前正在运行的 session，先 abort 流
    if (id === activeSessionIdRef.current && running) {
      abort()
    }
    setSessions(prev => prev.filter(s => s.id !== id))
    if (activeSessionId === id) {
      if (batchTimerRef.current) { clearTimeout(batchTimerRef.current); batchTimerRef.current = null }
      setActiveSessionId(null)
      activeSessionIdRef.current = null
      setCurrentPrompt("")
      setCurrentEvents([])
      currentEventsRef.current = []
    }
  }, [activeSessionId, running, abort])

  // ── submit ─────────────────────────────────────────────────────────
  const handleSubmit = useCallback((prompt: string, enabledSkills: string[] = []) => {
    let sid = activeSessionIdRef.current
    let threadIdForRun: string | null = null

    if (!sid) {
      // Create a new session
      const newSession: Session = {
        id: generateId(),
        title: prompt.slice(0, 60),
        threadId: null,
        turns: [],
        createdAt: Date.now(),
      }
      setSessions(prev => [...prev, newSession])
      setActiveSessionId(newSession.id)
      activeSessionIdRef.current = newSession.id
      sid = newSession.id
      // threadIdForRun stays null → startThread
    } else {
      // Continuing existing session — get its thread ID
      threadIdForRun = sessions.find(s => s.id === sid)?.threadId ?? null
    }

    setCurrentPrompt(prompt)
    setCurrentEvents([])
    currentEventsRef.current = []
    currentPromptRef.current = prompt
    setRunning(true)

    run(
      prompt,
      threadIdForRun,
      enabledSkills,
      (event) => {
        // Capture the thread ID assigned by Codex SDK (uses thread_id field)
        if (event.type === "thread.started") {
          const tid = event.thread_id ?? null
          if (tid) {
            setSessions(prev =>
              prev.map(s =>
                s.id === activeSessionIdRef.current
                  ? { ...s, threadId: tid }
                  : s
              )
            )
          }
        }
        currentEventsRef.current = [...currentEventsRef.current, event]

        // 终止类事件立即刷新，普通事件每 80ms 批量合并一次，避免每个 SSE 事件都触发重渲染
        if (
          event.type === "turn.completed" ||
          event.type === "turn.failed" ||
          event.type === "error"
        ) {
          if (batchTimerRef.current) { clearTimeout(batchTimerRef.current); batchTimerRef.current = null }
          setCurrentEvents([...currentEventsRef.current])
          if (import.meta.env.DEV) console.log(`[events] immediate flush on ${event.type}: ${currentEventsRef.current.length} total events`)
        } else if (!batchTimerRef.current) {
          batchTimerRef.current = setTimeout(() => {
            batchTimerRef.current = null
            const snapshot = [...currentEventsRef.current]
            if (import.meta.env.DEV) console.log(`[events] batch flush: ${snapshot.length} events`)
            setCurrentEvents(snapshot)
          }, 80)
        }
      },
      () => {
        // Archive completed turn into the active session
        if (batchTimerRef.current) { clearTimeout(batchTimerRef.current); batchTimerRef.current = null }
        const completedTurn: Turn = {
          id: generateId(),
          userPrompt: currentPromptRef.current,
          events: currentEventsRef.current,
        }
        setSessions(prev =>
          prev.map(s =>
            s.id === activeSessionIdRef.current
              ? { ...s, turns: [...s.turns, completedTurn] }
              : s
          )
        )
        setCurrentPrompt("")
        setCurrentEvents([])
        currentEventsRef.current = []
        setRunning(false)
      }
    )
  }, [sessions, run, abort])

  // ── render ─────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex",
      height: "100vh",
      overflow: "hidden",
      background: "#171717",
    }}>
      {/* Left sidebar */}
      <Sidebar
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={handleDelete}
      />

      {/* Main content column */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--bg)",
      }}>
        {/* Header */}
        <header style={{
          flexShrink: 0,
          height: 52,
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          padding: "0 var(--content-px)",
        }}>
          <div style={{
            width: "100%",
            maxWidth: "var(--content-width)",
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <span style={{
              fontSize: 15, fontWeight: 600,
              color: "var(--text)", letterSpacing: "-0.01em",
            }}>
              AI
            </span>

            {running && (
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 13, color: "var(--text-2)",
              }}>
                <svg
                  style={{ animation: "spin 1s linear infinite" }}
                  width="14" height="14" viewBox="0 0 14 14" fill="none"
                >
                  <circle
                    cx="7" cy="7" r="6"
                    stroke="currentColor" strokeWidth="1.5"
                    strokeDasharray="28" strokeDashoffset="10"
                    strokeLinecap="round"
                  />
                </svg>
                Running…
              </div>
            )}
          </div>
        </header>

        {/* Messages */}
        <OutputLog
          turns={turns}
          currentPrompt={currentPrompt}
          currentEvents={currentEvents}
          running={running}
        />

        {/* Input */}
        <TaskInput onSubmit={handleSubmit} onAbort={abort} disabled={running} />
      </div>
    </div>
  )
}
