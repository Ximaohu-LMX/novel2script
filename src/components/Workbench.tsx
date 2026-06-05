import { useState, useMemo } from 'react'
import Editor from '@monaco-editor/react'
import type { Project, LLMConfig, ChapterScriptState, ChatMessage, Commit } from '../types'
import { generateScript, editScript } from '../agents'
import { commit, checkout, history, isDirty, getCommit, createBranch, switchBranch } from '../lib/version'
import { validateScriptYaml } from '../lib/schema'
import ScriptPreview from './ScriptPreview'
import DiffView from './DiffView'

interface Props {
  project: Project
  llm: LLMConfig
  state: ChapterScriptState
  onUpdate: (updater: (s: ChapterScriptState) => ChapterScriptState) => void
}

type View = 'preview' | 'code' | 'diff'

export default function Workbench({ project, llm, state, onUpdate }: Props) {
  const [view, setView] = useState<View>('preview')
  const [chatInput, setChatInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [diffPair, setDiffPair] = useState<{ old: string; new: string } | null>(null)
  const [pending, setPending] = useState<{ yaml: string; explanation: string } | null>(null)

  const chapter = project.chapters.find((c) => c.index === state.chapterIndex)!
  const v = state.versioning
  const charNames = useMemo(() => {
    const m: Record<string, string> = {}
    project.bible?.characters.forEach((c) => (m[c.id] = c.name))
    return m
  }, [project.bible])

  const validation = useMemo(() => validateScriptYaml(v.workingCopy), [v.workingCopy])

  // ---- 生成初稿 ----
  const generate = async () => {
    if (!project.bible) return
    setBusy(true)
    onUpdate((s) => ({ ...s, status: 'generating', error: undefined }))
    try {
      const prevState = project.chapterStates[state.chapterIndex - 1]
      const prevSummary = prevState?.versioning.workingCopy
        ? `(上一章已生成剧本)`
        : ''
      const { yaml, valid, errors } = await generateScript(
        chapter, project.bible, project.styleConfig, prevSummary, llm
      )
      onUpdate((s) => ({
        ...s,
        status: valid ? 'done' : 'error',
        error: valid ? undefined : errors.join('; '),
        versioning: commit(s.versioning, yaml, `生成第${state.chapterIndex}章初稿`, 'ai'),
      }))
    } catch (e: any) {
      onUpdate((s) => ({ ...s, status: 'error', error: e.message }))
    } finally {
      setBusy(false)
    }
  }

  // ---- 手动保存 workingCopy 为 commit ----
  const saveManual = () => {
    onUpdate((s) => ({
      ...s,
      versioning: commit(s.versioning, s.versioning.workingCopy, '手动编辑', 'user'),
    }))
  }

  // ---- 对话编辑 ----
  const sendChat = async () => {
    const text = chatInput.trim()
    if (!text || !project.bible) return
    setChatInput('')
    const userMsg: ChatMessage = { id: rid(), role: 'user', content: text, timestamp: Date.now() }
    onUpdate((s) => ({ ...s, chat: [...s.chat, userMsg] }))
    setBusy(true)
    try {
      const { explanation, yaml } = await editScript(v.workingCopy, text, project.bible, llm)
      const aiMsg: ChatMessage = { id: rid(), role: 'assistant', content: explanation, pendingYaml: yaml, timestamp: Date.now() }
      onUpdate((s) => ({ ...s, chat: [...s.chat, aiMsg] }))
      setPending({ yaml, explanation })
      setDiffPair({ old: v.workingCopy, new: yaml })
      setView('diff')
    } catch (e: any) {
      const aiMsg: ChatMessage = { id: rid(), role: 'assistant', content: `出错:${e.message}`, timestamp: Date.now() }
      onUpdate((s) => ({ ...s, chat: [...s.chat, aiMsg] }))
    } finally {
      setBusy(false)
    }
  }

  const acceptPending = () => {
    if (!pending) return
    onUpdate((s) => ({ ...s, versioning: commit(s.versioning, pending.yaml, '对话修改', 'ai') }))
    setPending(null)
    setDiffPair(null)
    setView('preview')
  }
  const rejectPending = () => {
    setPending(null)
    setDiffPair(null)
    setView('preview')
  }

  const doCheckout = (id: string) => onUpdate((s) => ({ ...s, versioning: checkout(s.versioning, id) }))
  const viewCommitDiff = (c: Commit) => {
    const parent = c.parent ? getCommit(v, c.parent) : undefined
    setDiffPair({ old: parent?.snapshot ?? '', new: c.snapshot })
    setView('diff')
  }

  const addBranch = () => {
    const name = prompt('新分支名称(如 dark-version):')
    if (name) onUpdate((s) => ({ ...s, versioning: createBranch(s.versioning, name) }))
  }

  const hasContent = v.commits.length > 0 || v.workingCopy.trim()

  return (
    <div style={layout}>
      {/* ===== 左:版本时间线 ===== */}
      <div style={leftPane}>
        <div style={paneHeader}>
          <span>版本历史</span>
          <button className="ghost small" onClick={addBranch} title="新建分支">⎇</button>
        </div>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <select value={v.currentBranch} onChange={(e) => onUpdate((s) => ({ ...s, versioning: switchBranch(s.versioning, e.target.value) }))}>
            {Object.keys(v.branches).map((b) => <option key={b} value={b}>⎇ {b}</option>)}
          </select>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: 8 }}>
          {history(v).length === 0 && <p className="faint" style={{ fontSize: 12, padding: 8 }}>暂无提交</p>}
          {history(v).map((c) => (
            <div key={c.id} style={{ ...commitItem, borderColor: c.id === v.head ? 'var(--ink)' : 'var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span className={`tag ${c.author}`}>{c.author === 'ai' ? 'AI' : '手动'}</span>
                <span style={{ fontSize: 12, flex: 1 }}>{c.message}</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="ghost small" onClick={() => viewCommitDiff(c)}>diff</button>
                {c.id !== v.head && <button className="ghost small" onClick={() => doCheckout(c.id)}>回到此版本</button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ===== 中:编辑/预览 ===== */}
      <div style={midPane}>
        <div style={paneHeader}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['preview', 'code', 'diff'] as View[]).map((vw) => (
              <button key={vw} className={view === vw ? 'primary small' : 'ghost small'}
                onClick={() => setView(vw)} disabled={vw === 'diff' && !diffPair}>
                {vw === 'preview' ? '预览' : vw === 'code' ? 'YAML' : 'Diff'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {validation.valid
              ? <span className="tag" style={{ color: 'var(--accent-bright)' }}>✓ Schema 合法</span>
              : <span className="tag" style={{ color: 'var(--danger)' }}>✗ {validation.errors.length} 处错误</span>}
            {isDirty(v) && <button className="accent small" onClick={saveManual}>保存为版本</button>}
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
          {!hasContent ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
              <p className="muted">第 {state.chapterIndex} 章「{chapter.title}」尚未生成</p>
              <button className="primary" disabled={busy} onClick={generate}>
                {busy ? <><span className="spinner" /> &nbsp;生成中…</> : '生成剧本初稿'}
              </button>
            </div>
          ) : view === 'preview' ? (
            <ScriptPreview yamlText={v.workingCopy} charNames={charNames} />
          ) : view === 'code' ? (
            <Editor
              height="100%"
              language="yaml"
              theme="vs-dark"
              value={v.workingCopy}
              onChange={(val) => onUpdate((s) => ({ ...s, versioning: { ...s.versioning, workingCopy: val ?? '' } }))}
              options={{ fontSize: 13, minimap: { enabled: false }, wordWrap: 'on' }}
            />
          ) : diffPair ? (
            <DiffView oldText={diffPair.old} newText={diffPair.new} />
          ) : null}
        </div>

        {/* 待审阅条 */}
        {pending && (
          <div style={pendingBar} className="fade-in">
            <span style={{ fontSize: 12, flex: 1 }}>AI 改动:{pending.explanation}</span>
            <button className="ghost small" onClick={rejectPending}>拒绝</button>
            <button className="primary small" onClick={acceptPending}>接受</button>
          </div>
        )}
      </div>

      {/* ===== 右:对话 ===== */}
      <div style={rightPane}>
        <div style={paneHeader}>对话修改</div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {state.chat.length === 0 && (
            <p className="faint" style={{ fontSize: 12 }}>
              生成初稿后,可在此用自然语言指令修改,例如:
              <br />「把第2场的对白改得更紧张」
              <br />「给林深加一句内心独白」
            </p>
          )}
          {state.chat.map((m) => (
            <div key={m.id} style={{ ...bubble, ...(m.role === 'user' ? userBubble : aiBubble) }}>
              {m.content}
            </div>
          ))}
          {busy && <div style={{ ...bubble, ...aiBubble }}><span className="spinner" /></div>}
        </div>
        <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendChat() }}
            placeholder="输入修改指令…(Ctrl/Cmd + Enter 发送)"
            disabled={!hasContent || busy}
            style={{ minHeight: 60, fontSize: 13 }}
          />
          <button className="primary" style={{ width: '100%', marginTop: 8 }}
            disabled={!hasContent || busy || !chatInput.trim()} onClick={sendChat}>
            发送
          </button>
        </div>
      </div>
    </div>
  )
}

function rid() { return Math.random().toString(36).slice(2, 10) }

const layout: React.CSSProperties = { display: 'grid', gridTemplateColumns: '230px 1fr 300px', height: '100%', overflow: 'hidden' }
const paneBase: React.CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }
const leftPane: React.CSSProperties = { ...paneBase, borderRight: '1px solid var(--border)', background: 'var(--bg-panel)' }
const midPane: React.CSSProperties = { ...paneBase }
const rightPane: React.CSSProperties = { ...paneBase, borderLeft: '1px solid var(--border)', background: 'var(--bg-panel)' }
const paneHeader: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px',
  borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700, color: 'var(--text-dim)', minHeight: 44,
}
const commitItem: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 6, padding: 8, marginBottom: 6, background: 'var(--bg-panel-2)' }
const pendingBar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
  borderTop: '1px solid var(--accent)', background: 'var(--bg-elev)',
}
const bubble: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, fontSize: 13, maxWidth: '90%', whiteSpace: 'pre-wrap' }
const userBubble: React.CSSProperties = { alignSelf: 'flex-end', background: 'var(--ink)', color: '#1a1a1a' }
const aiBubble: React.CSSProperties = { alignSelf: 'flex-start', background: 'var(--bg-elev)', border: '1px solid var(--border)' }
