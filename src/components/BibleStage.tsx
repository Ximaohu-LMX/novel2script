import { useState, type ReactNode } from 'react'
import type { Project, LLMConfig, StoryBible, BibleCharacter, BibleLocation, BibleSubLocation, CharacterRole } from '../types'
import { extractBible } from '../agents'
import { commit } from '../lib/version'
import { findProjectReferences, replaceProjectTextReferences, type ScriptReference } from '../lib/references'

interface Props {
  project: Project
  llm: LLMConfig
  onUpdate: (updater: (p: Project) => Project) => void
}

const ROLE_LABEL: Record<CharacterRole, string> = {
  protagonist: '主角', antagonist: '反派', supporting: '配角', minor: '龙套',
}

export default function BibleStage({ project, llm, onUpdate }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showDeprecatedCharacters, setShowDeprecatedCharacters] = useState(false)
  const [showDeprecatedLocations, setShowDeprecatedLocations] = useState(false)
  const [flashItem, setFlashItem] = useState<{ kind: 'character' | 'location'; id: string } | null>(null)
  const [blockedDelete, setBlockedDelete] = useState<{ title: string; refs: ScriptReference[] } | null>(null)
  const [focusedName, setFocusedName] = useState<{ kind: 'character' | 'location'; id: string; name: string } | null>(null)
  const [renameFlow, setRenameFlow] = useState<RenameFlow | null>(null)
  const bible = project.bible
  const activeCharacters = bible?.characters.filter((c) => !c.deprecated) ?? []
  const deprecatedCharacters = bible?.characters.filter((c) => c.deprecated) ?? []
  const activeLocations = bible?.locations.filter((location) => !location.deprecated) ?? []
  const deprecatedLocations = bible?.locations.filter((location) => location.deprecated) ?? []

  const analyze = async () => {
    setBusy(true)
    setError('')
    try {
      const title = project.name || '未命名'
      const result = await extractBible(project.chapters, title, llm)
      onUpdate((p) => ({ ...p, bible: result }))
    } catch (e: any) {
      setError(e.message || '分析失败')
    } finally {
      setBusy(false)
    }
  }

  const patchBible = (updater: (b: StoryBible) => StoryBible) =>
    onUpdate((p) => (p.bible ? { ...p, bible: updater(p.bible) } : p))

  const updateChar = (id: string, patch: Partial<BibleCharacter>) =>
    patchBible((b) => ({ ...b, characters: b.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))

  const flashMovedItem = (kind: 'character' | 'location', id: string) => {
    setFlashItem({ kind, id })
    window.setTimeout(() => {
      setFlashItem((current) => (current?.kind === kind && current.id === id ? null : current))
    }, 1000)
  }

  const deprecateChar = (id: string) => {
    updateChar(id, { deprecated: true })
    setShowDeprecatedCharacters(true)
    flashMovedItem('character', id)
  }
  const restoreChar = (id: string) => {
    updateChar(id, { deprecated: false })
    flashMovedItem('character', id)
  }
  const purgeChar = (character: BibleCharacter) => {
    const refs = findProjectReferences(project, { kind: 'character', value: character.id })
    if (refs.length) {
      setBlockedDelete({ title: `角色「${character.name}」仍被剧本引用`, refs })
      return
    }
    patchBible((b) => ({ ...b, characters: b.characters.filter((c) => c.id !== character.id) }))
  }

  const addChar = () =>
    patchBible((b) => ({
      ...b,
      characters: [
        ...b.characters,
        { id: `char_${b.characters.length + 1}_${Date.now() % 1000}`, name: '新人物', aliases: [], role: 'supporting', description: '', traits: [] },
      ],
    }))

  const updateLocation = (id: string, patch: Partial<BibleLocation>) =>
    patchBible((b) => ({
      ...b,
      locations: b.locations.map((location) => (
        location.id === id ? { ...location, subLocations: location.subLocations ?? [], ...patch } : location
      )),
    }))

  const deprecateLocation = (id: string) => {
    updateLocation(id, { deprecated: true })
    setShowDeprecatedLocations(true)
    flashMovedItem('location', id)
  }
  const restoreLocation = (id: string) => {
    updateLocation(id, { deprecated: false })
    flashMovedItem('location', id)
  }
  const purgeLocation = (location: BibleLocation) => {
    const refs = findProjectReferences(project, { kind: 'location', value: location.name, includeText: true })
    if (refs.length) {
      setBlockedDelete({ title: `地点「${location.name}」仍被剧本引用`, refs })
      return
    }
    patchBible((b) => ({ ...b, locations: b.locations.filter((item) => item.id !== location.id) }))
  }

  const addLocation = () =>
    patchBible((b) => ({
      ...b,
      locations: [
        ...b.locations,
        { id: `loc_${b.locations.length + 1}_${Date.now() % 1000}`, name: '新大场景', description: '', subLocations: [] },
      ],
    }))

  const updateSubLocation = (locationId: string, subId: string, patch: Partial<BibleSubLocation>) =>
    patchBible((b) => ({
      ...b,
      locations: b.locations.map((location) => {
        if (location.id !== locationId) return location
        const subLocations = location.subLocations ?? []
        return {
          ...location,
          subLocations: subLocations.map((sub) => (sub.id === subId ? { ...sub, ...patch } : sub)),
        }
      }),
    }))

  const removeSubLocation = (locationId: string, subId: string) =>
    patchBible((b) => ({
      ...b,
      locations: b.locations.map((location) => (
        location.id === locationId
          ? { ...location, subLocations: (location.subLocations ?? []).filter((sub) => sub.id !== subId) }
          : location
      )),
    }))

  const addSubLocation = (locationId: string) =>
    patchBible((b) => ({
      ...b,
      locations: b.locations.map((location) => {
        if (location.id !== locationId) return location
        const subLocations = location.subLocations ?? []
        return {
          ...location,
          subLocations: [
            ...subLocations,
            { id: `${location.id}_sub_${subLocations.length + 1}_${Date.now() % 1000}`, name: '新小场景', description: '' },
          ],
        }
      }),
    }))

  const handleNameBlur = (kind: 'character' | 'location', id: string, newName: string) => {
    if (!focusedName || focusedName.kind !== kind || focusedName.id !== id) return
    const oldName = focusedName.name.trim()
    const nextName = newName.trim()
    setFocusedName(null)
    if (!oldName || !nextName || oldName === nextName) return
    setRenameFlow({ step: 'confirm', kind, oldName, newName: nextName, refs: [], selected: new Set() })
  }

  const scanRenameReferences = () => {
    if (!renameFlow) return
    const refs = findProjectReferences(
      project,
      renameFlow.kind === 'character'
        ? { kind: 'text', value: renameFlow.oldName, includeText: true }
        : { kind: 'location', value: renameFlow.oldName, includeText: true }
    )
    setRenameFlow({
      ...renameFlow,
      step: 'review',
      refs,
      selected: new Set(refs.map(refKey)),
    })
  }

  const toggleRenameRef = (key: string) => {
    if (!renameFlow) return
    const selected = new Set(renameFlow.selected)
    selected.has(key) ? selected.delete(key) : selected.add(key)
    setRenameFlow({ ...renameFlow, selected })
  }

  const applyRenameReplacements = () => {
    if (!renameFlow) return
    const replacements = renameFlow.refs
      .filter((ref) => renameFlow.selected.has(refKey(ref)))
      .map((ref) => ({
        chapterIndex: ref.chapterIndex,
        path: ref.path,
        from: renameFlow.oldName,
        to: renameFlow.newName,
      }))
    const yamlByChapter = replaceProjectTextReferences(project, replacements)
    onUpdate((p) => ({
      ...p,
      chapterStates: Object.entries(yamlByChapter).reduce((states, [idx, yaml]) => {
        const chapterIndex = Number(idx)
        const current = states[chapterIndex]
        if (!current) return states
        return {
          ...states,
          [chapterIndex]: {
            ...current,
            versioning: commit(current.versioning, yaml, `批量改名:${renameFlow.oldName}→${renameFlow.newName}`, 'user'),
          },
        }
      }, p.chapterStates),
    }))
    setRenameFlow(null)
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h1 style={{ fontSize: 28 }}>② 确认设定</h1>
        <button className="ghost small" onClick={() => onUpdate((p) => ({ ...p, stage: 'input' }))}>← 返回章节</button>
      </div>
      <p className="muted" style={{ marginBottom: 20 }}>
        AI 已从全文抽取人物、地点与世界观。请确认并编辑——这些设定是所有章节剧本一致性的依据。
      </p>

      {!bible && (
        <button className="primary" disabled={busy} onClick={analyze}>
          {busy ? <><span className="spinner" /> &nbsp;分析全文中…</> : '开始分析设定'}
        </button>
      )}
      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{error}</p>}

      {bible && (
        <div className="fade-in">
          {/* 人物 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '24px 0 12px' }}>
            <h2 style={{ fontSize: 18 }}>人物 · {activeCharacters.length}</h2>
            <button className="ghost small" onClick={addChar}>+ 添加人物</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {activeCharacters.map((c) => (
              <div key={c.id} style={card} className={flashItem?.kind === 'character' && flashItem.id === c.id ? 'moved-item-flash' : undefined}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input value={c.name}
                    onFocus={() => setFocusedName({ kind: 'character', id: c.id, name: c.name })}
                    onBlur={(e) => handleNameBlur('character', c.id, e.target.value)}
                    onChange={(e) => updateChar(c.id, { name: e.target.value })}
                    style={{ fontFamily: 'var(--serif)', fontWeight: 700, color: 'var(--ink)' }} />
                  <select value={c.role} onChange={(e) => updateChar(c.id, { role: e.target.value as CharacterRole })}
                    style={{ width: 'auto' }}>
                    {(Object.keys(ROLE_LABEL) as CharacterRole[]).map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                </div>
                <textarea value={c.description} onChange={(e) => updateChar(c.id, { description: e.target.value })}
                  placeholder="人物描述" style={{ minHeight: 56, fontSize: 12, marginBottom: 6 }} />
                <input value={c.traits.join('、')} onChange={(e) => updateChar(c.id, { traits: e.target.value.split(/[、,，]/).filter(Boolean) })}
                  placeholder="性格标签(顿号分隔)" style={{ fontSize: 12, marginBottom: 6 }} />
                {c.aliases.length > 0 && <p className="faint" style={{ fontSize: 11 }}>别称:{c.aliases.join('、')}</p>}
                <button className="ghost small danger" style={{ marginTop: 8 }} onClick={() => deprecateChar(c.id)}>标记弃用</button>
              </div>
            ))}
          </div>

          <DeprecatedSection
            title={`已弃用角色(${deprecatedCharacters.length})`}
            open={showDeprecatedCharacters}
            onToggle={() => setShowDeprecatedCharacters((v) => !v)}
          >
            {deprecatedCharacters.length === 0 ? (
              <p className="faint" style={{ fontSize: 12 }}>暂无已弃用角色。</p>
            ) : deprecatedCharacters.map((character) => (
              <div key={character.id} style={deprecatedRow} className={flashItem?.kind === 'character' && flashItem.id === character.id ? 'moved-item-flash' : undefined}>
                <div style={{ flex: 1 }}>
                  <strong>{character.name}</strong>
                  <span className="faint" style={{ fontSize: 12, marginLeft: 8 }}>{character.id}</span>
                </div>
                <button className="ghost small" onClick={() => restoreChar(character.id)}>恢复</button>
                <button className="ghost small danger" onClick={() => purgeChar(character)}>彻底删除</button>
              </div>
            ))}
          </DeprecatedSection>

          {/* 世界观 */}
          <h2 style={{ fontSize: 18, margin: '24px 0 12px' }}>世界观 / 背景</h2>
          <textarea value={bible.worldview} onChange={(e) => patchBible((b) => ({ ...b, worldview: e.target.value }))}
            placeholder="时代背景、特殊设定等" style={{ minHeight: 80 }} />

          {/* 地点 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '24px 0 12px' }}>
            <h2 style={{ fontSize: 18 }}>主要场景 · {activeLocations.length}</h2>
            <button className="ghost small" onClick={addLocation}>+ 添加大场景</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {activeLocations.map((location) => {
              const subLocations = location.subLocations ?? []
              return (
                <div key={location.id} style={card} className={flashItem?.kind === 'location' && flashItem.id === location.id ? 'moved-item-flash' : undefined}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input
                      value={location.name}
                      onFocus={() => setFocusedName({ kind: 'location', id: location.id, name: location.name })}
                      onBlur={(e) => handleNameBlur('location', location.id, e.target.value)}
                      onChange={(e) => updateLocation(location.id, { name: e.target.value })}
                      style={{ fontFamily: 'var(--serif)', fontWeight: 700, color: 'var(--ink)' }}
                    />
                    <button className="ghost small danger" style={{ width: 'auto' }} onClick={() => deprecateLocation(location.id)}>标记弃用</button>
                  </div>
                  <textarea
                    value={location.description}
                    onChange={(e) => updateLocation(location.id, { description: e.target.value })}
                    placeholder="大场景描述"
                    style={{ minHeight: 56, fontSize: 12, marginBottom: 10 }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span className="label" style={{ marginBottom: 0 }}>小场景 · {subLocations.length}</span>
                    <button className="ghost small" onClick={() => addSubLocation(location.id)}>+ 添加小场景</button>
                  </div>
                  {subLocations.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {subLocations.map((sub) => (
                        <div key={sub.id} style={subLocationCard}>
                          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                            <input
                              value={sub.name}
                              onChange={(e) => updateSubLocation(location.id, sub.id, { name: e.target.value })}
                              placeholder="小场景名"
                              style={{ fontSize: 12 }}
                            />
                            <button className="ghost small danger" style={{ width: 'auto' }} onClick={() => removeSubLocation(location.id, sub.id)}>删除</button>
                          </div>
                          <textarea
                            value={sub.description}
                            onChange={(e) => updateSubLocation(location.id, sub.id, { description: e.target.value })}
                            placeholder={`${location.name || '大场景'}-${sub.name || '小场景'} 的描述`}
                            style={{ minHeight: 48, fontSize: 12 }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            {activeLocations.length === 0 && <p className="faint" style={{ fontSize: 12 }}>暂无场景。可手动添加大场景与小场景。</p>}
          </div>

          <DeprecatedSection
            title={`已弃用地点(${deprecatedLocations.length})`}
            open={showDeprecatedLocations}
            onToggle={() => setShowDeprecatedLocations((v) => !v)}
          >
            {deprecatedLocations.length === 0 ? (
              <p className="faint" style={{ fontSize: 12 }}>暂无已弃用地点。</p>
            ) : deprecatedLocations.map((location) => (
              <div key={location.id} style={deprecatedRow} className={flashItem?.kind === 'location' && flashItem.id === location.id ? 'moved-item-flash' : undefined}>
                <div style={{ flex: 1 }}>
                  <strong>{location.name}</strong>
                  <span className="faint" style={{ fontSize: 12, marginLeft: 8 }}>地点</span>
                </div>
                <button className="ghost small" onClick={() => restoreLocation(location.id)}>恢复</button>
                <button className="ghost small danger" onClick={() => purgeLocation(location)}>彻底删除</button>
              </div>
            ))}
          </DeprecatedSection>

          <div style={{ display: 'flex', gap: 8, marginTop: 28 }}>
            <button className="ghost" onClick={analyze} disabled={busy}>
              {busy ? '重新分析中…' : '↻ 重新分析'}
            </button>
            <button className="primary" onClick={() => onUpdate((p) => ({ ...p, stage: 'generate' }))}>
              确认设定,进入剧本生成 →
            </button>
          </div>
        </div>
      )}
      {blockedDelete && (
        <BlockedDeleteDialog
          title={blockedDelete.title}
          refs={blockedDelete.refs}
          onClose={() => setBlockedDelete(null)}
        />
      )}
      {renameFlow && (
        <RenameDialog
          flow={renameFlow}
          onScan={scanRenameReferences}
          onOnlySetting={() => setRenameFlow(null)}
          onToggleRef={toggleRenameRef}
          onConfirm={applyRenameReplacements}
          onCancel={() => setRenameFlow(null)}
        />
      )}
    </div>
  )
}

type RenameFlow = {
  step: 'confirm' | 'review'
  kind: 'character' | 'location'
  oldName: string
  newName: string
  refs: ScriptReference[]
  selected: Set<string>
}

function refKey(ref: ScriptReference): string {
  return `${ref.chapterIndex}:${ref.path}`
}

function DeprecatedSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <button className="ghost small" onClick={onToggle}>
        {open ? `隐藏${title}` : title}
      </button>
      {open && (
        <div style={deprecatedPanel}>
          {children}
        </div>
      )}
    </div>
  )
}

function RenameDialog({
  flow,
  onScan,
  onOnlySetting,
  onToggleRef,
  onConfirm,
  onCancel,
}: {
  flow: RenameFlow
  onScan: () => void
  onOnlySetting: () => void
  onToggleRef: (key: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  if (flow.step === 'confirm') {
    return (
      <div style={modalMask}>
        <div style={modal}>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>确认改名</h2>
          <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
            已将「{flow.oldName}」改为「{flow.newName}」。是否同时替换剧本正文中出现的旧名字?
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="ghost" onClick={onOnlySetting}>仅改设定</button>
            <button className="primary" onClick={onScan}>扫描并查看</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={modalMask}>
      <div style={modal}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>选择替换位置</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          将「{flow.oldName}」替换为「{flow.newName}」。默认全部勾选,可取消容易误伤的位置。
        </p>
        {flow.refs.length === 0 ? (
          <p className="faint" style={{ fontSize: 12 }}>未在已生成章节中找到旧名字。</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflow: 'auto' }}>
            {flow.refs.map((ref) => {
              const key = refKey(ref)
              return (
                <label key={key} style={renameRefRow}>
                  <input
                    type="checkbox"
                    checked={flow.selected.has(key)}
                    onChange={() => onToggleRef(key)}
                    style={{ width: 'auto', marginTop: 2 }}
                  />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <strong>第{ref.chapterIndex}章 {ref.chapterTitle}</strong>
                    <span className="faint" style={{ fontSize: 12 }}>
                      {ref.sceneId ? `场景 ${ref.sceneId} · ` : ''}{ref.field}
                    </span>
                    <span style={{ fontSize: 12 }}>{ref.text}</span>
                  </span>
                </label>
              )
            })}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="ghost" onClick={onCancel}>取消</button>
          <button className="primary" onClick={onConfirm} disabled={flow.selected.size === 0}>确认替换</button>
        </div>
      </div>
    </div>
  )
}

function BlockedDeleteDialog({ title, refs, onClose }: { title: string; refs: ScriptReference[]; onClose: () => void }) {
  return (
    <div style={modalMask}>
      <div style={modal}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>无法彻底删除</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>{title}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflow: 'auto' }}>
          {refs.map((ref, index) => (
            <div key={`${ref.chapterIndex}-${ref.path}-${index}`} style={refRow}>
              <strong>第{ref.chapterIndex}章 {ref.chapterTitle}</strong>
              <span className="faint" style={{ fontSize: 12 }}>
                {ref.sceneId ? `场景 ${ref.sceneId} · ` : ''}{ref.field}
              </span>
              <span style={{ fontSize: 12 }}>{ref.text}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="primary" onClick={onClose}>知道了</button>
        </div>
      </div>
    </div>
  )
}

const card: React.CSSProperties = {
  background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 14,
}

const subLocationCard: React.CSSProperties = {
  background: 'var(--bg-panel-2)', border: '1px solid var(--border)', borderRadius: 6, padding: 10,
}

const deprecatedPanel: React.CSSProperties = {
  marginTop: 10,
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 12,
  background: 'var(--bg-panel)',
}

const deprecatedRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  borderTop: '1px solid var(--border)',
  padding: '10px 0',
}

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
  width: 'min(640px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  background: 'var(--bg-panel)',
  border: '1px solid var(--border-strong)',
  borderRadius: 8,
  boxShadow: 'var(--shadow)',
  padding: 18,
}

const refRow: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: 8,
  background: 'var(--bg-panel-2)',
}

const renameRefRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: 8,
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: 8,
  background: 'var(--bg-panel-2)',
  cursor: 'pointer',
}
