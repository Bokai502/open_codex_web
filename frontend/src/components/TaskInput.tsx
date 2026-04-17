import { useState, useRef, useEffect } from "react"

interface AttachedFile {
  name: string
  content: string
  ext: string
}

interface AtMenuState {
  atIndex: number   // @ 在 value 中的位置
  query: string     // @ 后面已输入的过滤文本
}

interface Skill {
  name: string
  description: string
}

interface Props {
  onSubmit: (prompt: string, enabledSkills: string[]) => void
  onAbort: () => void
  disabled: boolean
}

export function TaskInput({ onSubmit, onAbort, disabled }: Props) {
  const [value, setValue] = useState("")
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [atMenu, setAtMenu] = useState<AtMenuState | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const [menuHover, setMenuHover] = useState<number>(0)

  // 启动时拉取 skill 列表
  useEffect(() => {
    fetch("/api/skills")
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setSkills(data) })
      .catch(() => { /* 后端不可用时静默 */ })
  }, [])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // 保存触发 @ 菜单时的光标位置，供文件选中后替换
  const pendingAtIndexRef = useRef<number | null>(null)

  useEffect(() => {
    if (!disabled) textareaRef.current?.focus()
  }, [disabled])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 180) + "px"
  }, [value])

  // 点击外部关闭 @ 菜单
  useEffect(() => {
    if (!atMenu) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAtMenu(null)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [atMenu])

  // 从光标往前找最近的 @，返回其索引；@ 前面必须是字符串开头或空白字符；@ 到光标之间不能有空白
  const findAtTrigger = (text: string, cursor: number): { atIndex: number; query: string } | null => {
    for (let i = cursor - 1; i >= 0; i--) {
      const ch = text[i]
      if (ch === "@") {
        const before = i === 0 ? " " : text[i - 1]
        if (/\s/.test(before)) {
          return { atIndex: i, query: text.slice(i + 1, cursor) }
        }
        return null
      }
      if (/\s/.test(ch)) return null
    }
    return null
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value
    setValue(newVal)

    const cursor = e.target.selectionStart ?? newVal.length
    const trigger = findAtTrigger(newVal, cursor)

    if (trigger) {
      setAtMenu({ atIndex: trigger.atIndex, query: trigger.query })
      setMenuHover(0)
      pendingAtIndexRef.current = trigger.atIndex
    } else {
      setAtMenu(null)
    }
  }

  // 根据 @ 查询文本过滤可用菜单项（Add file + 未选中的 skill）
  const menuItems = (() => {
    const q = (atMenu?.query ?? "").toLowerCase()
    type Item =
      | { kind: "file"; label: string; hint: string }
      | { kind: "skill"; label: string; hint: string; name: string }
    const items: Item[] = []
    if (!q || "add file".includes(q) || "file".includes(q)) {
      items.push({ kind: "file", label: "Add file", hint: "@file" })
    }
    for (const s of skills) {
      if (selectedSkills.includes(s.name)) continue
      if (!q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)) {
        items.push({ kind: "skill", label: s.name, hint: s.description, name: s.name })
      }
    }
    return items
  })()

  // 确保 hover index 在有效范围内
  useEffect(() => {
    if (menuHover >= menuItems.length) setMenuHover(0)
  }, [menuItems.length, menuHover])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (atMenu && menuItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setMenuHover(i => (i + 1) % menuItems.length)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setMenuHover(i => (i - 1 + menuItems.length) % menuItems.length)
        return
      }
      if (e.key === "Tab") {
        e.preventDefault()
        selectMenuItem(menuHover)
        return
      }
    }

    if (e.key === "Escape" && atMenu) {
      e.preventDefault()
      setAtMenu(null)
      return
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (atMenu && menuItems.length > 0) {
        selectMenuItem(menuHover)
        return
      }
      if ((value.trim() || attachedFiles.length > 0 || selectedSkills.length > 0) && !disabled) {
        doSubmit()
      }
    }
  }

  const selectMenuItem = (idx: number) => {
    const item = menuItems[idx]
    if (!item) return
    if (item.kind === "file") {
      triggerFilePicker()
    } else {
      addSkill(item.name)
    }
  }

  const addSkill = (name: string) => {
    setSelectedSkills(prev => prev.includes(name) ? prev : [...prev, name])
    // 从输入文本中删掉 @query 整段
    if (atMenu) {
      const { atIndex, query } = atMenu
      setValue(prev => prev.slice(0, atIndex) + prev.slice(atIndex + 1 + query.length))
    }
    setAtMenu(null)
    pendingAtIndexRef.current = null
    textareaRef.current?.focus()
  }

  const removeSkill = (name: string) => {
    setSelectedSkills(prev => prev.filter(n => n !== name))
  }

  // ── @ file picker ──────────────────────────────────────────────────

  const triggerFilePicker = () => {
    setAtMenu(null)
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const newAttachments: AttachedFile[] = []
    for (const file of Array.from(files)) {
      try {
        const content = await file.text()
        const ext = file.name.includes(".")
          ? file.name.split(".").pop()!.toLowerCase()
          : ""
        newAttachments.push({ name: file.name, content, ext })
      } catch {
        // 跳过无法读取的文件（如二进制）
      }
    }
    setAttachedFiles(prev => [...prev, ...newAttachments])

    // 把 @ + 过滤查询文本一起从输入框中删除
    if (pendingAtIndexRef.current !== null) {
      const idx = pendingAtIndexRef.current
      const queryLen = atMenu?.query.length ?? 0
      setValue(prev => prev.slice(0, idx) + prev.slice(idx + 1 + queryLen))
      pendingAtIndexRef.current = null
    }

    // 重置 file input，允许重复选择同一文件
    e.target.value = ""
    textareaRef.current?.focus()
  }

  const removeFile = (name: string) => {
    setAttachedFiles(prev => prev.filter(f => f.name !== name))
  }

  // ── submit ─────────────────────────────────────────────────────────

  const doSubmit = () => {
    const parts: string[] = []

    // 将附件内容以 markdown 代码块方式注入 prompt
    for (const f of attachedFiles) {
      parts.push(`\`\`\`${f.ext || "text"} title="${f.name}"\n${f.content}\n\`\`\``)
    }
    if (value.trim()) parts.push(value.trim())

    const finalPrompt = parts.join("\n\n")
    if (!finalPrompt.trim() && selectedSkills.length === 0) return

    onSubmit(finalPrompt, selectedSkills)
    setValue("")
    setAttachedFiles([])
    setSelectedSkills([])
  }

  const handleAction = () => {
    if (disabled) {
      onAbort()
    } else {
      doSubmit()
    }
  }

  const canSend = value.trim().length > 0 || attachedFiles.length > 0 || selectedSkills.length > 0

  return (
    <div ref={containerRef} style={{
      flexShrink: 0,
      background: "var(--bg)",
      padding: "12px var(--content-px) 20px",
      position: "relative",   // @ 菜单用 absolute 定位
    }}>
      <div style={{
        maxWidth: "var(--content-width)",
        margin: "0 auto",
      }}>

        {/* ── 已选 skill chips ── */}
        {selectedSkills.length > 0 && (
          <div style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 8,
          }}>
            {selectedSkills.map(name => (
              <div key={`skill:${name}`} style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px 3px 10px",
                background: "var(--bg-3, #2a2a2a)",
                border: "1px solid var(--border-2)",
                borderRadius: 20,
                fontSize: 12,
                color: "var(--text-2)",
              }}>
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none"
                  style={{ flexShrink: 0, opacity: 0.7 }}>
                  <path d="M7 1.5l1.7 3.6 3.8.5-2.8 2.7.7 3.7L7 10.3l-3.4 1.7.7-3.7L1.5 5.6l3.8-.5L7 1.5z"
                    stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                </svg>
                <span>{name}</span>
                <button
                  onClick={() => removeSkill(name)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    color: "var(--text-3)",
                    flexShrink: 0,
                  }}
                  title="Remove skill"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 2l6 6M8 2l-6 6"
                      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── 已附加的文件 chips ── */}
        {attachedFiles.length > 0 && (
          <div style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 8,
          }}>
            {attachedFiles.map(f => (
              <div key={f.name} style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px 3px 10px",
                background: "var(--bg-3, #2a2a2a)",
                border: "1px solid var(--border-2)",
                borderRadius: 20,
                fontSize: 12,
                color: "var(--text-2)",
                maxWidth: 200,
              }}>
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none"
                  style={{ flexShrink: 0, opacity: 0.7 }}>
                  <rect x="1" y="3" width="12" height="9" rx="1.5"
                    stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M1 6h12" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M4 1l1.5 2h3L10 1" stroke="currentColor"
                    strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {f.name}
                </span>
                <button
                  onClick={() => removeFile(f.name)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    color: "var(--text-3)",
                    flexShrink: 0,
                  }}
                  title="Remove"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 2l6 6M8 2l-6 6"
                      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── 输入框（相对定位容器，用于承载 @ 菜单）── */}
        <div style={{ position: "relative" }}>

        {/* ── @ 触发菜单：锚定在输入框正上方，左对齐 ── */}
        {atMenu && menuItems.length > 0 && (
          <div style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: 0,
            right: 0,
            zIndex: 100,
            background: "var(--bg-2, #222)",
            border: "1px solid var(--border-2)",
            borderRadius: 10,
            boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
            padding: "4px",
            maxHeight: 260,
            overflowY: "auto",
          }}>
            {menuItems.map((item, idx) => {
              const active = idx === menuHover
              return (
                <button
                  key={item.kind === "skill" ? `skill:${item.name}` : "file"}
                  onMouseDown={e => { e.preventDefault(); selectMenuItem(idx) }}
                  onMouseEnter={() => setMenuHover(idx)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "7px 12px",
                    background: active ? "var(--bg-3, #2a2a2a)" : "transparent",
                    border: "none",
                    borderRadius: 7,
                    cursor: "pointer",
                    fontSize: 13,
                    color: "var(--text)",
                    textAlign: "left",
                  }}
                >
                  {item.kind === "file" ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <rect x="1" y="3" width="12" height="9" rx="1.5"
                        stroke="currentColor" strokeWidth="1.3"/>
                      <path d="M1 6h12" stroke="currentColor" strokeWidth="1.3"/>
                      <path d="M4 1l1.5 2h3L10 1" stroke="currentColor"
                        strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M7 1.5l1.7 3.6 3.8.5-2.8 2.7.7 3.7L7 10.3l-3.4 1.7.7-3.7L1.5 5.6l3.8-.5L7 1.5z"
                        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                    </svg>
                  )}
                  <span style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}>
                    {item.label}
                  </span>
                  <span style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    opacity: 0.5,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 240,
                  }}>
                    {item.hint}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <div style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 8,
          background: "var(--bg)",
          border: "1px solid var(--border-2)",
          borderRadius: 16,
          padding: "10px 10px 10px 16px",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.04), 0 2px 12px rgba(0,0,0,0.07)",
          transition: "border-color 0.15s, box-shadow 0.15s",
        }}>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder="Message AI… (type @ to attach a file)"
            rows={1}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              resize: "none",
              fontFamily: "var(--font)",
              fontSize: 15,
              lineHeight: "1.6",
              color: "var(--text)",
              padding: 0,
              minHeight: 24,
              maxHeight: 180,
              overflowY: "auto",
            }}
          />

          {/* Send / Stop button */}
          <button
            onClick={handleAction}
            disabled={!disabled && !canSend}
            style={{
              flexShrink: 0,
              width: 34,
              height: 34,
              borderRadius: 8,
              border: "none",
              cursor: disabled || canSend ? "pointer" : "default",
              background: disabled
                ? "#000"
                : canSend
                  ? "#000"
                  : "var(--bg-3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.15s, opacity 0.15s",
              opacity: !disabled && !canSend ? 0.35 : 1,
            }}
          >
            {disabled ? (
              <div style={{ width: 10, height: 10, background: "#fff", borderRadius: 2 }} />
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
                  stroke="white" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
        </div>

        {/* Hint */}
        <p style={{
          textAlign: "center",
          marginTop: 8,
          fontSize: 12,
          color: "var(--text-3)",
        }}>
          {disabled
            ? "AI is working — click ■ to stop"
            : "Enter to send · Shift+Enter for new line · @ to add file or skill"}
        </p>
      </div>

      {/* 隐藏的 file input，支持多文件选择 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={handleFileSelected}
      />
    </div>
  )
}
