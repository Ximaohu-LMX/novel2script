import { useState, useMemo } from 'react'
import Editor from '@monaco-editor/react'
import type { Project, LLMConfig, ChapterScriptState, ChatMessage, Commit, BibleCharacter } from '../types'
import { generateScript, editScript } from '../agents'
import { commit, checkout, history, isDirty, getCommit, createBranch, switchBranch } from '../lib/version'
import { validateScriptYaml } from '../lib/schema'
import {
  collectUnknownScriptCharacters,
  composeDiffReview,
  createDiffReview,
  isReviewComplete,
  mergeCharacterDraft,
  reviewHunks,
  setHunkStatuses,
  type DiffReview,
  type HunkStatus,
} from '../lib/diffReview'
import ScriptPreview from './ScriptPreview'
import DiffView from './DiffView'

interface Props {
  project: Project
  llm: LLMConfig
  state: ChapterScriptState
  onUpdate: (updater: (s: ChapterScriptState) => ChapterScriptState) => void
  onProjectUpdate: (updater: (p: Project) => Project) => void
}

type View = 'preview' | 'code' | 'diff'
type StreamOutput = {
  kind: 'edit'
  title: string
  text: string
  done: boolean
}

export default function Workbench({ project, llm, state, onUpdate, onProjectUpdate }: Props) {
  const [view, setView] = useState<View>('preview')
  const [chatInput, setChatInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [streamOutput, setStreamOutput] = useState<StreamOutput | null>(null)
  const [diffPair, setDiffPair] = useState<{ old: string; new: string } | null>(null)
  const [pendingReview, setPendingReview] = useState<DiffReview | null>(null)
  const [pendingValidation, setPendingValidation] = useState<{ valid: boolean; errors: string[] } | null>(null)
  const [characterReview, setCharacterReview] = useState<{ hunkId: string; characters: CharacterDraft[] } | null>(null)
  const [deprecatedConfirm, setDeprecatedConfirm] = useState<{ hunkIds: string[]; characters: BibleCharacter[] } | null>(null)
  const [deprecatedConfirmed, setDeprecatedConfirmed] = useState(false)
  const [lastReviewWarning, setLastReviewWarning] = useState('')

  const chapter = project.chapters.find((c) => c.index === state.chapterIndex)!
  const v = state.versioning
  const charNames = useMemo(() => {
    const m: Record<string, string> = {}
    project.bible?.characters.forEach((c) => (m[c.id] = c.name))
    return m
  }, [project.bible])

  const validation = useMemo(() => validateScriptYaml(v.workingCopy), [v.workingCopy])
  const characterById = useMemo(() => {
    const m: Record<string, BibleCharacter> = {}
    project.bible?.characters.forEach((c) => (m[c.id] = c))
    return m
  }, [project.bible])
  const chapterCharacters = useMemo(() => {
    const ids = new Set<string>()
    validation.data?.scenes.forEach((scene) => {
      scene.characters_present.forEach((id) => ids.add(id))
    })
    return Array.from(ids).map((id) => characterById[id] ?? { id, name: id, aliases: [], role: 'minor' as const, description: '', traits: [] })
  }, [characterById, validation.data])
  const deprecatedChapterCharacters = chapterCharacters.filter((c) => c.deprecated)
  const pendingDeprecatedCharacters = useMemo(() => (
    pendingReview ? collectDeprecatedScriptCharacters(pendingReview.proposedYaml, characterById) : []
  ), [characterById, pendingReview])

  // ---- 生成初稿 ----
  const generate = async () => {
    if (!project.bible) return
    setBusy(true)
    setStreamOutput(null)
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
    setStreamOutput({ kind: 'edit', title: 'AI 正在修改', text: '', done: false })
    try {
      const { explanation, yaml } = await editScript(
        v.workingCopy,
        text,
        project.bible,
        llm,
        (delta) => setStreamOutput((current) => appendStream(current, 'edit', 'AI 正在修改', delta))
      )
      const aiMsg: ChatMessage = { id: rid(), role: 'assistant', content: explanation, pendingYaml: yaml, timestamp: Date.now() }
      onUpdate((s) => ({ ...s, chat: [...s.chat, aiMsg] }))
      const review = createDiffReview(v.workingCopy, yaml, explanation)
      setPendingReview(review)
      setPendingValidation(validateScriptYaml(composeDiffReview(review)))
      setDeprecatedConfirm(null)
      setDeprecatedConfirmed(false)
      setLastReviewWarning('')
      setDiffPair({ old: v.workingCopy, new: yaml })
      setView('diff')
      setStreamOutput((current) => current ? { ...current, done: true, title: '修改完成,请逐块审阅' } : current)
    } catch (e: any) {
      const aiMsg: ChatMessage = { id: rid(), role: 'assistant', content: `出错:${e.message}`, timestamp: Date.now() }
      onUpdate((s) => ({ ...s, chat: [...s.chat, aiMsg] }))
      setStreamOutput((current) => current ? { ...current, done: true, title: `修改出错:${e.message}` } : current)
    } finally {
      setBusy(false)
    }
  }

  const applyHunkDecision = (hunkId: string, status: HunkStatus, skipCharacterCheck = false, skipDeprecatedCheck = false) => {
    applyHunkDecisions([hunkId], status, skipCharacterCheck, skipDeprecatedCheck)
  }

  const applyPendingHunks = (status: HunkStatus) => {
    if (!pendingReview) return
    const ids = reviewHunks(pendingReview).filter((hunk) => hunk.status === 'pending').map((hunk) => hunk.id)
    applyHunkDecisions(ids, status)
  }

  const applyHunkDecisions = (hunkIds: string[], status: HunkStatus, skipCharacterCheck = false, skipDeprecatedCheck = false) => {
    if (!pendingReview) return
    if (!hunkIds.length) return
    if (status === 'accepted' && !skipDeprecatedCheck && !deprecatedConfirmed && pendingDeprecatedCharacters.length) {
      setDeprecatedConfirm({ hunkIds, characters: pendingDeprecatedCharacters })
      return
    }
    if (status === 'accepted' && !skipCharacterCheck) {
      const knownIds = new Set(project.bible?.characters.map((c) => c.id) ?? [])
      const beforeUnknown = new Set(collectUnknownScriptCharacters(composeDiffReview(pendingReview), knownIds).map((c) => c.id))
      const overrides = Object.fromEntries(hunkIds.map((id) => [id, 'accepted' as const]))
      const candidate = composeDiffReview(pendingReview, overrides)
      const proposedById = new Map(
        collectUnknownScriptCharacters(pendingReview.proposedYaml, knownIds).map((c) => [c.id, c])
      )
      const introduced = collectUnknownScriptCharacters(candidate, knownIds)
        .filter((c) => !beforeUnknown.has(c.id))
        .map((c) => mergeCharacterDraft(c, proposedById.get(c.id)))

      if (introduced.length) {
        setCharacterReview({ hunkId: hunkIds.join(','), characters: introduced })
        return
      }
    }

    finishHunkDecisions(pendingReview, hunkIds, status)
  }

  const finishHunkDecisions = (review: DiffReview, hunkIds: string[], status: HunkStatus) => {
    const updated = setHunkStatuses(review, hunkIds, status)
    const composed = composeDiffReview(updated)
    const finalValidation = validateScriptYaml(composed)
    setPendingValidation(finalValidation)
    if (isReviewComplete(updated)) {
      setLastReviewWarning(finalValidation.valid ? '' : `对话修改后 Schema 警告:${finalValidation.errors.join('; ')}`)
      onUpdate((s) => ({ ...s, versioning: commit(s.versioning, composed, '对话修改', 'ai') }))
      setPendingReview(null)
      setPendingValidation(null)
      setDiffPair(null)
      setView('preview')
      return
    }
    setPendingReview(updated)
  }

  const cancelNewCharacter = () => {
    if (!characterReview || !pendingReview) return
    const hunkIds = characterReview.hunkId.split(',').filter(Boolean)
    setCharacterReview(null)
    finishHunkDecisions(pendingReview, hunkIds, 'rejected')
  }

  const confirmNewCharacter = () => {
    if (!characterReview || !pendingReview) return
    const { hunkId, characters } = characterReview
    onProjectUpdate((p) => {
      if (!p.bible) return p
      const existing = new Set(p.bible.characters.map((c) => c.id))
      return {
        ...p,
        bible: {
          ...p.bible,
          characters: [
            ...p.bible.characters,
            ...characters.filter((c) => !existing.has(c.id)),
          ],
        },
      }
    })
    setCharacterReview(null)
    finishHunkDecisions(pendingReview, hunkId.split(',').filter(Boolean), 'accepted')
  }

  const confirmDeprecatedUse = () => {
    if (!deprecatedConfirm) return
    const hunkIds = deprecatedConfirm.hunkIds
    setDeprecatedConfirm(null)
    setDeprecatedConfirmed(true)
    applyHunkDecisions(hunkIds, 'accepted', false, true)
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
                onClick={() => setView(vw)} disabled={vw === 'diff' && !diffPair && !pendingReview}>
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
          {deprecatedChapterCharacters.length > 0 && (
            <div style={warningBar}>
              本章包含已弃用角色:{deprecatedChapterCharacters.map((c) => c.name).join('、')}
            </div>
          )}
          {lastReviewWarning && <div style={warningBar}>{lastReviewWarning}</div>}
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
          ) : pendingReview ? (
            <DiffView
              oldText={pendingReview.baseYaml}
              newText={composeDiffReview(pendingReview)}
              review={pendingReview}
              warning={pendingValidation && !pendingValidation.valid ? pendingValidation.errors.join('; ') : undefined}
              onAcceptHunk={(id) => applyHunkDecision(id, 'accepted')}
              onRejectHunk={(id) => applyHunkDecision(id, 'rejected')}
              onResetHunk={(id) => applyHunkDecision(id, 'pending')}
            />
          ) : diffPair ? (
            <DiffView oldText={diffPair.old} newText={diffPair.new} />
          ) : null}
        </div>

        {/* 待审阅条 */}
        {pendingReview && (
          <div style={pendingBar} className="fade-in">
            {(() => {
              const hunks = reviewHunks(pendingReview)
              const pendingCount = hunks.filter((h) => h.status === 'pending').length
              return (
                <>
                  <span style={{ fontSize: 12, flex: 1 }}>
                    AI 改动:{pendingReview.explanation} · 待处理 {pendingCount}/{hunks.length} 块
                  </span>
                  <button className="ghost small" disabled={pendingCount === 0} onClick={() => applyPendingHunks('rejected')}>一键拒绝</button>
                  <button className="primary small" disabled={pendingCount === 0} onClick={() => applyPendingHunks('accepted')}>一键接受</button>
                </>
              )
            })()}
          </div>
        )}
      </div>

      {/* ===== 右:对话 ===== */}
      <div style={rightPane}>
        <div style={paneHeader}>对话修改</div>
        <ChapterCast characters={chapterCharacters} />
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
          {streamOutput?.kind === 'edit' && (
            <div style={{ ...bubble, ...aiBubble, maxWidth: '100%' }}>
              <div className="label" style={{ marginBottom: 6 }}>
                {streamOutput.done ? streamOutput.title : <><span className="spinner" /> &nbsp;{streamOutput.title}</>}
              </div>
              <pre style={streamPre}>{streamOutput.text || '等待模型返回...'}</pre>
            </div>
          )}
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
      {characterReview && (
        <NewCharacterDialog
          characters={characterReview.characters}
          onChange={(characters) => setCharacterReview((r) => (r ? { ...r, characters } : r))}
          onConfirm={confirmNewCharacter}
          onCancel={cancelNewCharacter}
        />
      )}
      {deprecatedConfirm && (
        <DeprecatedUseDialog
          characters={deprecatedConfirm.characters}
          onConfirm={confirmDeprecatedUse}
          onCancel={() => setDeprecatedConfirm(null)}
        />
      )}
    </div>
  )
}

function rid() { return Math.random().toString(36).slice(2, 10) }

function appendStream(current: StreamOutput | null, kind: StreamOutput['kind'], title: string, delta: string): StreamOutput {
  return {
    kind: current?.kind ?? kind,
    title: current?.title ?? title,
    text: `${current?.text ?? ''}${delta}`,
    done: false,
  }
}

function collectDeprecatedScriptCharacters(text: string, characterById: Record<string, BibleCharacter>): BibleCharacter[] {
  const result = validateScriptYaml(text)
  if (!result.valid || !result.data) return []
  const ids = new Set<string>()
  result.data.characters.forEach((character) => ids.add(character.id))
  result.data.scenes.forEach((scene) => {
    scene.characters_present.forEach((id) => ids.add(id))
    scene.elements.forEach((element) => {
      if (element.character) ids.add(element.character)
    })
  })
  return Array.from(ids)
    .map((id) => characterById[id])
    .filter((character): character is BibleCharacter => Boolean(character?.deprecated))
}

function ChapterCast({ characters }: { characters: BibleCharacter[] }) {
  return (
    <div style={castBox}>
      <div className="label" style={{ marginBottom: 8 }}>本章出场角色</div>
      {characters.length ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {characters.map((character) => (
            <span key={character.id} className="tag" style={character.deprecated ? deprecatedTag : undefined} title={character.id}>
              {character.name}{character.deprecated ? ' ⚠ 已弃用' : ''}
            </span>
          ))}
        </div>
      ) : (
        <p className="faint" style={{ fontSize: 12 }}>暂无可解析的出场角色</p>
      )}
    </div>
  )
}

type CharacterDraft = BibleCharacter

const ROLE_LABELS = {
  protagonist: '主角',
  antagonist: '反派',
  supporting: '配角',
  minor: '龙套',
} as const

function NewCharacterDialog({
  characters,
  onChange,
  onConfirm,
  onCancel,
}: {
  characters: CharacterDraft[]
  onChange: (characters: CharacterDraft[]) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const update = (id: string, patch: Partial<CharacterDraft>) => {
    onChange(characters.map((character) => (character.id === id ? { ...character, ...patch } : character)))
  }

  return (
    <div style={modalMask}>
      <div style={modal}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>发现新角色</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
          这块改动引入了全局人物表中不存在的角色。请确认设定后再接受该块改动。
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {characters.map((character) => (
            <div key={character.id} style={newCharCard}>
              <label className="label">角色 id</label>
              <input value={character.id} readOnly style={{ marginBottom: 8 }} />
              <label className="label">姓名</label>
              <input value={character.name} onChange={(e) => update(character.id, { name: e.target.value })} style={{ marginBottom: 8 }} />
              <label className="label">定位</label>
              <select value={character.role} onChange={(e) => update(character.id, { role: e.target.value as CharacterDraft['role'] })} style={{ marginBottom: 8 }}>
                {(Object.keys(ROLE_LABELS) as CharacterDraft['role'][]).map((role) => (
                  <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                ))}
              </select>
              <label className="label">描述</label>
              <textarea value={character.description} onChange={(e) => update(character.id, { description: e.target.value })} style={{ minHeight: 64, marginBottom: 8 }} />
              <label className="label">特征</label>
              <input
                value={character.traits.join('、')}
                onChange={(e) => update(character.id, { traits: e.target.value.split(/[、,，]/).map((v) => v.trim()).filter(Boolean) })}
              />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="ghost" onClick={onCancel}>取消并拒绝该块</button>
          <button className="primary" onClick={onConfirm}>确认并接受</button>
        </div>
      </div>
    </div>
  )
}

function DeprecatedUseDialog({
  characters,
  onConfirm,
  onCancel,
}: {
  characters: BibleCharacter[]
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div style={modalMask}>
      <div style={modal}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>AI 改动引用了已弃用角色</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          本次返回结果包含已弃用角色:{characters.map((c) => c.name).join('、')}。继续接受会保留这些引用。
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="ghost" onClick={onCancel}>先不接受</button>
          <button className="primary" onClick={onConfirm}>继续接受</button>
        </div>
      </div>
    </div>
  )
}

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
const warningBar: React.CSSProperties = {
  borderBottom: '1px solid var(--danger)',
  color: 'var(--danger)',
  background: 'rgba(200, 115, 106, 0.12)',
  padding: '8px 14px',
  fontSize: 13,
}
const streamPre: React.CSSProperties = {
  margin: 0,
  padding: 10,
  maxHeight: 240,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'var(--mono)',
  fontSize: 12,
  lineHeight: 1.6,
  color: 'var(--text)',
}
const castBox: React.CSSProperties = {
  padding: 12,
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-panel-2)',
}
const deprecatedTag: React.CSSProperties = {
  color: 'var(--danger)',
  borderColor: 'var(--danger)',
  background: 'rgba(200, 115, 106, 0.10)',
}
const bubble: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, fontSize: 13, maxWidth: '90%', whiteSpace: 'pre-wrap' }
const userBubble: React.CSSProperties = { alignSelf: 'flex-end', background: 'var(--ink)', color: '#1a1a1a' }
const aiBubble: React.CSSProperties = { alignSelf: 'flex-start', background: 'var(--bg-elev)', border: '1px solid var(--border)' }
const modalMask: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 20,
  background: 'rgba(0, 0, 0, 0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
}
const modal: React.CSSProperties = {
  width: 'min(560px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  background: 'var(--bg-panel)',
  border: '1px solid var(--border-strong)',
  borderRadius: 8,
  boxShadow: 'var(--shadow)',
  padding: 18,
}
const newCharCard: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: 12,
  background: 'var(--bg-panel-2)',
}
