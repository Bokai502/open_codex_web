import { useState, useRef, useEffect, useCallback, type PointerEvent as ReactPointerEvent } from "react"
import { Sidebar } from "./components/Sidebar"
import { TaskInput } from "./components/TaskInput"
import { OutputLog } from "./components/OutputLog"
import { useCodexStream } from "./hooks/useTaskStream"
import type { AskUserItem, ThreadEvent, Turn, Session } from "./types"
import { shouldSuppressEvent } from "./utils/codexEventFilter"

// ── helpers ──────────────────────────────────────────────────────────
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function getPendingAskUser(session: Session | null): AskUserItem | null {
  const lastTurn = session?.turns[session.turns.length - 1]
  if (!lastTurn) return null

  for (let i = lastTurn.events.length - 1; i >= 0; i--) {
    const event = lastTurn.events[i]
    if (event.type === "item.completed" && event.item.type === "ask_user") {
      return session?.dismissedAskUserId === event.item.id ? null : event.item
    }
  }

  return null
}

// localStorage 作为即时读取的缓存层（同步，避免白屏）
const STORAGE_KEY = "codex_sessions"
const SIDEBAR_COLLAPSED_KEY = "codex_sidebar_collapsed"
const WORKSPACE_WIDTH_KEY = "codex_workspace_width"
const WORKSPACE_PAGES = [
  { key: "viewer", label: "Viewer 3D", href: "/viewer" },
  { key: "earth", label: "Earth", href: "/earth" },
  { key: "freecad", label: "FreeCAD", href: "http://10.110.10.11:7080/vnc.html?autoconnect=true&resize=scale&path=websockify" },
] as const

type WorkspacePageKey = (typeof WORKSPACE_PAGES)[number]["key"]

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"
    } catch {
      return false
    }
  })
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [currentPrompt, setCurrentPrompt] = useState("")
  const [currentEvents, setCurrentEvents] = useState<ThreadEvent[]>([])
  const [running, setRunning] = useState(false)
  const [workspacePage, setWorkspacePage] = useState<WorkspacePageKey | null>(null)
  const [workspaceWidth, setWorkspaceWidth] = useState(() => {
    try {
      const raw = localStorage.getItem(WORKSPACE_WIDTH_KEY)
      const parsed = raw ? Number.parseInt(raw, 10) : NaN
      return Number.isFinite(parsed) ? parsed : 520
    } catch {
      return 520
    }
  })
  const [isResizingWorkspace, setIsResizingWorkspace] = useState(false)

  // Refs for use inside async callbacks (avoid stale closures)
  const currentEventsRef = useRef<ThreadEvent[]>([])
  const currentPromptRef = useRef("")
  const currentTurnIdRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  // 始终持有最新 sessions，供 beforeunload 等非响应式回调使用
  const sessionsRef = useRef<Session[]>(sessions)
  const workspaceWidthRef = useRef(workspaceWidth)

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

  useEffect(() => {
    workspaceWidthRef.current = workspaceWidth
  }, [workspaceWidth])

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0")
    } catch {
      // ignore storage errors
    }
  }, [sidebarCollapsed])

  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_WIDTH_KEY, String(workspaceWidth))
    } catch {
      // ignore storage errors
    }
  }, [workspaceWidth])

  // 启动时从后端加载完整 session，并与 localStorage 合并
  // 同一 session 优先采用 localStorage 中较新的 turns，缺失时回退到后端
  useEffect(() => {
    apiLoad().then(serverSessions => {
      if (serverSessions.length === 0) return
      const lsSessions = lsLoad()
      const merged = serverSessions.map(serverSession => {
        const localSession = lsSessions.find(ls => ls.id === serverSession.id)
        return {
          ...serverSession,
          turns: localSession?.turns ?? serverSession.turns ?? [],
        }
      })
      // 保留尚未同步到后端的 localStorage session（如刷新前 debounce 未触发的新 session）
      const lsOnly = lsSessions.filter(ls => !serverSessions.find(s => s.id === ls.id))
      const all = [...merged, ...lsOnly]
      isFirstLoadRef.current = true
      setSessions(all)
      lsSave(all)
    })
  }, [])

  // sessions 变化时同步写入 localStorage + 后端（跳过首次后端加载触发的冗余写）
  const apiSave = useCallback((sessions: Session[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sessions),
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
      navigator.sendBeacon(
        "/api/sessions",
        new Blob([JSON.stringify(current)], { type: "application/json" })
      )
    }
    window.addEventListener("beforeunload", flush)
    return () => window.removeEventListener("beforeunload", flush)
  }, [])

  // ── derived state ──────────────────────────────────────────────────
  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null
  const turns: Turn[] = activeSession?.turns ?? []
  const pendingAskUser = getPendingAskUser(activeSession)
  const activeWorkspace = WORKSPACE_PAGES.find(page => page.key === workspacePage) ?? null
  const activeWorkspaceHref = (() => {
    if (!activeWorkspace) return null
    if (activeWorkspace.key !== "viewer") return activeWorkspace.href
    if (!activeSessionId) return activeWorkspace.href

    const params = new URLSearchParams({ sessionId: activeSessionId })
    return `${activeWorkspace.href}?${params.toString()}`
  })()
  const clampedWorkspaceWidth = Math.min(Math.max(workspaceWidth, 320), 960)

  // ── session management ─────────────────────────────────────────────
  const handleNew = useCallback(() => {
    if (batchTimerRef.current) { clearTimeout(batchTimerRef.current); batchTimerRef.current = null }
    setActiveSessionId(null)
    activeSessionIdRef.current = null
    setCurrentPrompt("")
    setCurrentEvents([])
    currentEventsRef.current = []
    currentTurnIdRef.current = null
  }, [])

  const handleSelect = useCallback((id: string) => {
    if (running) return
    if (batchTimerRef.current) { clearTimeout(batchTimerRef.current); batchTimerRef.current = null }
    setActiveSessionId(id)
    activeSessionIdRef.current = id
    setCurrentPrompt("")
    setCurrentEvents([])
    currentEventsRef.current = []
    currentTurnIdRef.current = null
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
      currentTurnIdRef.current = null
    }
  }, [activeSessionId, running, abort])

  const handleStopAskUser = useCallback(() => {
    const sid = activeSessionIdRef.current
    if (!sid || !pendingAskUser) return
    setSessions(prev =>
      prev.map(s =>
        s.id === sid
          ? { ...s, dismissedAskUserId: pendingAskUser.id }
          : s
      )
    )
  }, [pendingAskUser])

  const handleWorkspaceResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const pointerId = event.pointerId
    const startX = event.clientX
    const startWidth = workspaceWidthRef.current
    const viewportWidth = window.innerWidth
    const maxWidth = Math.min(960, Math.floor(viewportWidth * 0.75))
    const minWidth = 320

    setIsResizingWorkspace(true)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX
      const nextWidth = Math.min(Math.max(startWidth + delta, minWidth), maxWidth)
      setWorkspaceWidth(nextWidth)
    }

    const stopResize = () => {
      setIsResizingWorkspace(false)
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", stopResize)
      window.removeEventListener("pointercancel", stopResize)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", stopResize)
    window.addEventListener("pointercancel", stopResize)
    ;(event.currentTarget as HTMLDivElement).setPointerCapture(pointerId)
  }, [])

  // ── submit ─────────────────────────────────────────────────────────
  const handleSubmit = useCallback((prompt: string, enabledSkills: string[] = []) => {
    let sid = activeSessionIdRef.current
    let threadIdForRun: string | null = null
    const turnIdForRun = generateId()

    if (!sid) {
      // Create a new session
      const newSession: Session = {
        id: generateId(),
        title: prompt.slice(0, 60),
        threadId: null,
        turns: [],
        createdAt: Date.now(),
        dismissedAskUserId: null,
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

    setSessions(prev => prev.map(s =>
      s.id === sid ? { ...s, dismissedAskUserId: null } : s
    ))
    setCurrentPrompt(prompt)
    setCurrentEvents([])
    currentEventsRef.current = []
    currentPromptRef.current = prompt
    currentTurnIdRef.current = turnIdForRun
    setRunning(true)

    run(
      prompt,
      sid,
      threadIdForRun,
      turnIdForRun,
      enabledSkills,
      (event) => {
        if (shouldSuppressEvent(event)) {
          return
        }

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
          id: currentTurnIdRef.current ?? generateId(),
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
        currentTurnIdRef.current = null
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
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
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
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}>
            <span style={{
              fontSize: 15, fontWeight: 600,
              color: "var(--text)", letterSpacing: "-0.01em",
            }}>
              AI Agent
            </span>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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

              <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
                {WORKSPACE_PAGES.map(page => (
                  <button
                    key={page.key}
                    type="button"
                    onClick={() => setWorkspacePage(current => current === page.key ? null : page.key)}
                    style={{
                      height: 34,
                      padding: "0 12px",
                      borderRadius: 8,
                      border: page.key === activeWorkspace?.key ? "1px solid transparent" : "1px solid var(--border)",
                      background: page.key === activeWorkspace?.key ? "var(--text)" : "var(--bg-2)",
                      color: page.key === activeWorkspace?.key ? "var(--bg)" : "var(--text)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    {page.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </header>

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <div style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}>
            {/* Messages */}
            <OutputLog
              turns={turns}
              currentPrompt={currentPrompt}
              currentEvents={currentEvents}
              running={running}
              pendingAskUser={pendingAskUser}
              onSubmitAskUser={answer => handleSubmit(answer)}
              onStopAskUser={handleStopAskUser}
            />

            {/* Input */}
            {!pendingAskUser && (
              <TaskInput
                onSubmit={handleSubmit}
                onAbort={abort}
                disabled={running}
              />
            )}
          </div>

          {activeWorkspace && (
            <>
              <div
                onPointerDown={handleWorkspaceResizeStart}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize workspace panel"
                style={{
                  width: 8,
                  flexShrink: 0,
                  cursor: "col-resize",
                  position: "relative",
                  background: isResizingWorkspace ? "rgba(15, 23, 42, 0.04)" : "transparent",
                }}
              >
                <div style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: 3,
                  width: 2,
                  borderRadius: 999,
                  background: isResizingWorkspace ? "var(--text-3)" : "transparent",
                }} />
              </div>

              <aside style={{
                width: clampedWorkspaceWidth,
                minWidth: 320,
                maxWidth: 960,
                borderLeft: "1px solid var(--border)",
                background: "var(--bg-2)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}>
              <div style={{
                height: 48,
                flexShrink: 0,
                padding: "0 12px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                background: "var(--bg)",
              }}>
                <div style={{
                  minWidth: 0,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {activeWorkspace.label}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <a
                    href={activeWorkspaceHref ?? activeWorkspace.href}
                    target="_blank"
                    rel="noreferrer"
                    title="Open in new tab"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      color: "var(--text-2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      textDecoration: "none",
                    }}
                  >
                    ↗
                  </a>
                  <button
                    type="button"
                    onClick={() => setWorkspacePage(null)}
                    title="Close panel"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      border: "none",
                      background: "transparent",
                      color: "var(--text-2)",
                      cursor: "pointer",
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>

              <iframe
                key={activeWorkspace.key}
                title={activeWorkspace.label}
                src={activeWorkspaceHref ?? activeWorkspace.href}
                style={{
                  flex: 1,
                  width: "100%",
                  border: "none",
                  background: "#fff",
                }}
              />
              </aside>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
