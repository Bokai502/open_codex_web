import { useState } from "react"
import type { Session } from "../types"

interface Props {
  sessions: Session[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

// ── 按日期分组 ─────────────────────────────────────────────────
function groupByDate(sessions: Session[]) {
  const startOfToday     = new Date().setHours(0, 0, 0, 0)
  const startOfYesterday = startOfToday - 86_400_000
  const startOfWeek      = startOfToday - 7 * 86_400_000
  const startOfMonth     = startOfToday - 30 * 86_400_000

  const groups: { label: string; items: Session[] }[] = [
    { label: "Today",            items: [] },
    { label: "Yesterday",        items: [] },
    { label: "Previous 7 Days",  items: [] },
    { label: "Previous 30 Days", items: [] },
    { label: "Older",            items: [] },
  ]

  // 最新的排最前
  for (const s of [...sessions].reverse()) {
    const t = s.createdAt
    if      (t >= startOfToday)     groups[0].items.push(s)
    else if (t >= startOfYesterday) groups[1].items.push(s)
    else if (t >= startOfWeek)      groups[2].items.push(s)
    else if (t >= startOfMonth)     groups[3].items.push(s)
    else                            groups[4].items.push(s)
  }

  return groups.filter(g => g.items.length > 0)
}

// ── 单条 session 项 ────────────────────────────────────────────
function SessionItem({ session, active, onSelect, onDelete }: {
  session: Session
  active: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "7px 10px",
        borderRadius: 6,
        cursor: "pointer",
        background: active
          ? "rgba(255,255,255,0.10)"
          : hovered
            ? "rgba(255,255,255,0.06)"
            : "transparent",
        transition: "background 0.1s",
        position: "relative",
      }}
    >
      <span style={{
        flex: 1, fontSize: 13.5,
        color: active ? "#ececf1" : "#b4b4b8",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        lineHeight: "1.4",
      }}>
        {session.title}
      </span>

      {/* 删除按钮 */}
      {(hovered || active) && (
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          title="Delete"
          style={{
            flexShrink: 0,
            width: 22, height: 22,
            borderRadius: 4,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "#6b6b6b",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "color 0.1s",
          }}
          onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
          onMouseLeave={e => (e.currentTarget.style.color = "#6b6b6b")}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2L10 10M10 2L2 10"
              stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  )
}

// ── 主组件 ────────────────────────────────────────────────────
export function Sidebar({ sessions, activeId, onSelect, onNew, onDelete }: Props) {
  const groups = groupByDate(sessions)

  return (
    <div style={{
      width: 260,
      flexShrink: 0,
      height: "100vh",
      background: "#171717",
      display: "flex",
      flexDirection: "column",
      borderRight: "1px solid rgba(255,255,255,0.06)",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0,
        padding: "14px 12px 8px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <span style={{
          fontSize: 15, fontWeight: 600,
          color: "#ececf1", letterSpacing: "-0.01em",
        }}>
          AI
        </span>

        {/* New chat 按钮 */}
        <button
          onClick={onNew}
          title="New chat"
          style={{
            width: 32, height: 32, borderRadius: 6,
            border: "none", background: "transparent",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#8e8ea0",
            transition: "background 0.1s, color 0.1s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(255,255,255,0.08)"
            e.currentTarget.style.color = "#ececf1"
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "transparent"
            e.currentTarget.style.color = "#8e8ea0"
          }}
        >
          {/* compose / pencil icon */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2.5 13.5H5.5L13 6L10 3L2.5 10.5V13.5Z"
              stroke="currentColor" strokeWidth="1.4"
              strokeLinejoin="round" />
            <path d="M10 3L13 6"
              stroke="currentColor" strokeWidth="1.4"
              strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Session list */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "4px 8px 16px",
      }}>
        {/* 空状态 */}
        {sessions.length === 0 && (
          <div style={{
            padding: "32px 8px",
            textAlign: "center",
            color: "#4a4a4f",
            fontSize: 13,
            lineHeight: "1.6",
          }}>
            No conversations yet.
            <br />
            Start a new chat!
          </div>
        )}

        {/* 分组列表 */}
        {groups.map(group => (
          <div key={group.label} style={{ marginBottom: 4 }}>
            <div style={{
              padding: "10px 10px 4px",
              fontSize: 11, fontWeight: 600,
              color: "#4a4a4f",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}>
              {group.label}
            </div>
            {group.items.map(s => (
              <SessionItem
                key={s.id}
                session={s}
                active={s.id === activeId}
                onSelect={() => onSelect(s.id)}
                onDelete={() => onDelete(s.id)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        flexShrink: 0,
        padding: "12px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{
          fontSize: 12, color: "#4a4a4f",
          textAlign: "center", letterSpacing: "-0.01em",
        }}>
          Powered by Codex SDK
        </div>
      </div>
    </div>
  )
}
