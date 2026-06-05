import { useState } from 'react'
import type { Project, LLMConfig, StoryBible, BibleCharacter, BibleLocation, BibleSubLocation, CharacterRole } from '../types'
import { extractBible } from '../agents'

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
  const bible = project.bible

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

  const removeChar = (id: string) =>
    patchBible((b) => ({ ...b, characters: b.characters.filter((c) => c.id !== id) }))

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

  const removeLocation = (id: string) =>
    patchBible((b) => ({ ...b, locations: b.locations.filter((location) => location.id !== id) }))

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
            <h2 style={{ fontSize: 18 }}>人物 · {bible.characters.length}</h2>
            <button className="ghost small" onClick={addChar}>+ 添加人物</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {bible.characters.map((c) => (
              <div key={c.id} style={card}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input value={c.name} onChange={(e) => updateChar(c.id, { name: e.target.value })}
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
                <button className="ghost small danger" style={{ marginTop: 8 }} onClick={() => removeChar(c.id)}>删除</button>
              </div>
            ))}
          </div>

          {/* 世界观 */}
          <h2 style={{ fontSize: 18, margin: '24px 0 12px' }}>世界观 / 背景</h2>
          <textarea value={bible.worldview} onChange={(e) => patchBible((b) => ({ ...b, worldview: e.target.value }))}
            placeholder="时代背景、特殊设定等" style={{ minHeight: 80 }} />

          {/* 地点 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '24px 0 12px' }}>
            <h2 style={{ fontSize: 18 }}>主要场景 · {bible.locations.length}</h2>
            <button className="ghost small" onClick={addLocation}>+ 添加大场景</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {bible.locations.map((location) => {
              const subLocations = location.subLocations ?? []
              return (
                <div key={location.id} style={card}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input
                      value={location.name}
                      onChange={(e) => updateLocation(location.id, { name: e.target.value })}
                      style={{ fontFamily: 'var(--serif)', fontWeight: 700, color: 'var(--ink)' }}
                    />
                    <button className="ghost small danger" style={{ width: 'auto' }} onClick={() => removeLocation(location.id)}>删除</button>
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
            {bible.locations.length === 0 && <p className="faint" style={{ fontSize: 12 }}>暂无场景。可手动添加大场景与小场景。</p>}
          </div>

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
    </div>
  )
}

const card: React.CSSProperties = {
  background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 14,
}

const subLocationCard: React.CSSProperties = {
  background: 'var(--bg-panel-2)', border: '1px solid var(--border)', borderRadius: 6, padding: 10,
}
