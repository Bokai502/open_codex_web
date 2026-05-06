import { useState, useRef, useEffect, useCallback } from "react"
import { useCodexStream } from "./useTaskStream"
import type { Session, ThreadEvent, Turn } from "../types"
import { shouldSuppressEvent } from "../utils/codexEventFilter"
import {
  apiLoad,
  findActiveSession,
  generateId,
  getPendingAskUser,
  getSessionIdFromPath,
  getTurns,
  lsLoad,
  lsSave,
  updateBrowserPath,
} from "../app/sessionUtils"

interface WorkspaceAppStateOptions {
  homePath?: string
}

export function useWorkspaceAppState({ homePath }: WorkspaceAppStateOptions = {}) {
  const [sessions, setSessions] = useState<Session[]>(() => lsLoad())
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => getSessionIdFromPath(window.location.pathname, homePath))
  const [currentPrompt, setCurrentPrompt] = useState("")
  const [currentEvents, setCurrentEvents] = useState<ThreadEvent[]>([])
  const [running, setRunning] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1100)
  const currentEventsRef = useRef<ThreadEvent[]>([])
  const currentPromptRef = useRef("")
  const currentTurnIdRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const sessionsRef = useRef<Session[]>(sessions)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstLoadRef = useRef(true)

  const { run, abort } = useCodexStream()

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1100)
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  useEffect(() => {
    const handlePopState = () => {
      const nextSessionId = getSessionIdFromPath(window.location.pathname, homePath)
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current)
        batchTimerRef.current = null
      }

      setActiveSessionId(nextSessionId)
      activeSessionIdRef.current = nextSessionId
      setCurrentPrompt("")
      setCurrentEvents([])
      currentEventsRef.current = []
      currentTurnIdRef.current = null
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [homePath])

  useEffect(() => {
    updateBrowserPath(activeSessionId, !activeSessionId, homePath)
  }, [])

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
      const lsOnly = lsSessions.filter(ls => !serverSessions.find(s => s.id === ls.id))
      const all = [...merged, ...lsOnly]
      isFirstLoadRef.current = true
      setSessions(all)
      lsSave(all)
    })
  }, [])

  const apiSave = useCallback((nextSessions: Session[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextSessions),
      }).catch(() => {
        // ignore network errors
      })
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

  const activeSession = findActiveSession(sessions, activeSessionId)
  const turns: Turn[] = getTurns(activeSession)
  const pendingAskUser = getPendingAskUser(activeSession)

  const resetLiveTurn = useCallback(() => {
    setCurrentPrompt("")
    setCurrentEvents([])
    currentEventsRef.current = []
    currentTurnIdRef.current = null
  }, [])

  const handleNew = useCallback(() => {
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current)
      batchTimerRef.current = null
    }
    setActiveSessionId(null)
    activeSessionIdRef.current = null
    updateBrowserPath(null, false, homePath)
    resetLiveTurn()
  }, [homePath, resetLiveTurn])

  const handleSelect = useCallback((id: string) => {
    if (running) return
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current)
      batchTimerRef.current = null
    }
    setActiveSessionId(id)
    activeSessionIdRef.current = id
    updateBrowserPath(id, false, homePath)
    resetLiveTurn()
  }, [homePath, resetLiveTurn, running])

  const handleDelete = useCallback((id: string) => {
    if (id === activeSessionIdRef.current && running) {
      abort()
    }

    setSessions(prev => prev.filter(session => session.id !== id))

    if (activeSessionIdRef.current === id) {
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current)
        batchTimerRef.current = null
      }
      setActiveSessionId(null)
      activeSessionIdRef.current = null
      updateBrowserPath(null, false, homePath)
      resetLiveTurn()
    }
  }, [abort, homePath, resetLiveTurn, running])

  const handleStopAskUser = useCallback(() => {
    const sid = activeSessionIdRef.current
    if (!sid || !pendingAskUser) return
    setSessions(prev =>
      prev.map(session =>
        session.id === sid
          ? { ...session, dismissedAskUserId: pendingAskUser.id }
          : session
      )
    )
  }, [pendingAskUser])

  const handleSubmit = useCallback((prompt: string, enabledSkills: string[] = []) => {
    let sid = activeSessionIdRef.current
    let threadIdForRun: string | null = null
    const turnIdForRun = generateId()

    if (!sid) {
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
      updateBrowserPath(newSession.id, false, homePath)
      sid = newSession.id
    } else {
      threadIdForRun = sessions.find(session => session.id === sid)?.threadId ?? null
      updateBrowserPath(sid, true, homePath)
    }

    setSessions(prev => prev.map(session =>
      session.id === sid ? { ...session, dismissedAskUserId: null } : session
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
      event => {
        if (shouldSuppressEvent(event)) return

        if (event.type === "thread.started") {
          const tid = event.thread_id ?? null
          if (tid) {
            setSessions(prev =>
              prev.map(session =>
                session.id === activeSessionIdRef.current
                  ? { ...session, threadId: tid }
                  : session
              )
            )
          }
        }

        currentEventsRef.current = [...currentEventsRef.current, event]

        if (
          event.type === "turn.completed" ||
          event.type === "turn.failed" ||
          event.type === "error"
        ) {
          if (batchTimerRef.current) {
            clearTimeout(batchTimerRef.current)
            batchTimerRef.current = null
          }
          setCurrentEvents([...currentEventsRef.current])
        } else if (!batchTimerRef.current) {
          batchTimerRef.current = setTimeout(() => {
            batchTimerRef.current = null
            setCurrentEvents([...currentEventsRef.current])
          }, 80)
        }
      },
      () => {
        if (batchTimerRef.current) {
          clearTimeout(batchTimerRef.current)
          batchTimerRef.current = null
        }

        const completedTurn: Turn = {
          id: currentTurnIdRef.current ?? generateId(),
          userPrompt: currentPromptRef.current,
          events: currentEventsRef.current,
        }

        setSessions(prev =>
          prev.map(session =>
            session.id === activeSessionIdRef.current
              ? { ...session, turns: [...session.turns, completedTurn] }
              : session
          )
        )

        resetLiveTurn()
        setRunning(false)
      }
    )
  }, [homePath, resetLiveTurn, run, sessions])

  const sortedSessions = [...sessions].sort((a, b) => b.createdAt - a.createdAt)
  return {
    activeSessionId,
    currentEvents,
    currentPrompt,
    handleDelete,
    handleNew,
    handleSelect,
    handleStopAskUser,
    handleSubmit,
    isMobile,
    pendingAskUser,
    running,
    sortedSessions,
    turns,
    abort,
  }
}
