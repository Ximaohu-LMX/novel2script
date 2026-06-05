import { useState } from 'react'
import type { Project, LLMConfig, ChapterScriptState, StyleConfig, ScriptStyle, DialogueDensity } from '../types'
import { initVersioning, commit } from '../lib/version'
import { generateScript } from '../agents'
import Workbench from './Workbench'

interface Props {
  project: Project
  llm: LLMConfig
  onUpdate: (updater: (p: Project) => Project) => void
}

function ensureState(project: Project, idx: number): ChapterScriptState {
  return project.chapterStates[idx] ?? {
    chapterIndex: idx,
    status: 'pending',
    versioning: initVersioning(''),
    chat: [],
  }
}

const STYLE_OPTS: { v: ScriptStyle; label: string }[] = [
  { v: 'screen', label: '影视剧' }, { v: 'stage', label: '话剧' }, { v: 'storyboard', label: '分镜脚本' },
]
const DENSITY_OPTS: { v: DialogueDensity; label: string }[] = [
  { v: 'sparse', label: '精简' }, { v: 'balanced', label: '均衡' }, { v: 'dense', label: '密集' },
]

export default function GenerateStage({ project, llm, onUpdate }: Props) {
  const [active, setActive] = useState(project.chapters[0]?.index ?? 1)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchProgress, setBatchProgress] = useState('')
  const [batchStreams, setBatchStreams] = useState<Record<number, string>>({})
  const allSelected = project.chapters.length > 0 && project.chapters.every((chapter) => selected.has(chapter.index))

  const setStyle = (patch: Partial<StyleConfig>) =>
    onUpdate((p) => ({ ...p, styleConfig: { ...p.styleConfig, ...patch } }))

  const updateChapterState = (idx: number, updater: (s: ChapterScriptState) => ChapterScriptState) =>
    onUpdate((p) => ({
      ...p,
      chapterStates: { ...p.chapterStates, [idx]: updater(ensureState(p, idx)) },
    }))

  const toggleSelect = (idx: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })

  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(project.chapters.map((c) => c.index)))
  }

  // 批量生成(受 maxConcurrency 限制)
  const batchGenerate = async () => {
    if (!project.bible || selected.size === 0) return
    setBatchBusy(true)
    setBatchStreams({})
    const indices = [...selected].sort((a, b) => a - b)
    let done = 0
    const concurrency = Math.max(1, llm.maxConcurrency)
    const queue = [...indices]

    const worker = async () => {
      while (queue.length) {
        const idx = queue.shift()!
        const chapter = project.chapters.find((c) => c.index === idx)!
        updateChapterState(idx, (s) => ({ ...s, status: 'generating' }))
        setBatchStreams((prev) => ({ ...prev, [idx]: '' }))
        try {
          const { yaml, valid, errors } = await generateScript(
            chapter,
            project.bible!,
            project.styleConfig,
            '',
            llm,
            (delta) => setBatchStreams((prev) => ({ ...prev, [idx]: `${prev[idx] ?? ''}${delta}` }))
          )
          updateChapterState(idx, (s) => ({
            ...s,
            status: valid ? 'done' : 'error',
            error: valid ? undefined : errors.join('; '),
            versioning: commit(s.versioning, yaml, `生成第${idx}章初稿`, 'ai'),
          }))
        } catch (e: any) {
          updateChapterState(idx, (s) => ({ ...s, status: 'error', error: e.message }))
        }
        done++
        setBatchProgress(`${done}/${indices.length}`)
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))
    setBatchBusy(false)
    setBatchProgress('')
    setBatchStreams({})
    setSelected(new Set())
  }

  const activeState = ensureState(project, active)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', height: '100%', overflow: 'hidden' }}>
      {/* 左:章节列表 + 风格 + 批量 */}
      <div style={sidebar}>
        <div style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
          <button className="ghost small" onClick={() => onUpdate((p) => ({ ...p, stage: 'bible' }))}>← 返回设定</button>
        </div>

        <div style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
          <label className="label">剧本风格</label>
          <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
            {STYLE_OPTS.map((o) => (
              <button key={o.v} className={project.styleConfig.style === o.v ? 'primary small' : 'ghost small'}
                onClick={() => setStyle({ style: o.v })}>{o.label}</button>
            ))}
          </div>
          <label className="label">对白密度</label>
          <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            {DENSITY_OPTS.map((o) => (
              <button key={o.v} className={project.styleConfig.density === o.v ? 'primary small' : 'ghost small'}
                onClick={() => setStyle({ density: o.v })}>{o.label}</button>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={project.styleConfig.includeNarration}
              onChange={(e) => setStyle({ includeNarration: e.target.checked })} />
            包含旁白
          </label>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {project.chapters.map((ch) => {
            const st = project.chapterStates[ch.index]
            const status = st?.status ?? 'pending'
            return (
              <div key={ch.index} style={{ ...chapterRow, borderColor: active === ch.index ? 'var(--ink)' : 'var(--border)' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={selected.has(ch.index)} onChange={() => toggleSelect(ch.index)} />
                <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setActive(ch.index)}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>第{ch.index}章 {ch.title}</div>
                  <StatusDot status={status} />
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
          <button className="ghost small" style={{ width: '100%', marginBottom: 6 }}
            onClick={toggleSelectAll}>{allSelected ? '取消全选' : '全选'}</button>
          <button className="primary" style={{ width: '100%' }} disabled={selected.size === 0 || batchBusy}
            onClick={batchGenerate}>
            {batchBusy ? `批量生成 ${batchProgress}` : `批量生成 (${selected.size})`}
          </button>
          {batchBusy && Object.keys(batchStreams).length > 0 && (
            <div style={batchStreamBox}>
              {Object.entries(batchStreams).map(([idx, text]) => (
                <div key={idx} style={{ marginBottom: 8 }}>
                  <div className="label" style={{ marginBottom: 4 }}>第{idx}章流式输出</div>
                  <pre style={batchStreamPre}>{text || '等待模型返回...'}</pre>
                </div>
              ))}
            </div>
          )}
          <ExportButtons project={project} />
        </div>
      </div>

      {/* 右:工作台 */}
      <Workbench
        project={project}
        llm={llm}
        state={activeState}
        onUpdate={(updater) => updateChapterState(active, updater)}
        onProjectUpdate={onUpdate}
      />
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    pending: ['待生成', 'var(--text-faint)'],
    generating: ['生成中', 'var(--accent-bright)'],
    done: ['已完成', 'var(--added-text)'],
    error: ['出错', 'var(--danger)'],
  }
  const [label, color] = map[status] || map.pending
  return <span style={{ fontSize: 10, color }}>● {label}</span>
}

function ExportButtons({ project }: { project: Project }) {
  const exportAll = () => {
    const parts: string[] = []
    project.chapters.forEach((ch) => {
      const st = project.chapterStates[ch.index]
      if (st?.versioning.workingCopy) {
        parts.push(`# ===== 第${ch.index}章 ${ch.title} =====\n${st.versioning.workingCopy}`)
      }
    })
    download(`${project.name || 'script'}.yaml`, parts.join('\n\n'))
  }
  return (
    <button className="ghost small" style={{ width: '100%', marginTop: 6 }} onClick={exportAll}>
      ↓ 导出全本 YAML
    </button>
  )
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/yaml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const sidebar: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
  borderRight: '1px solid var(--border)', background: 'var(--bg-panel)',
}
const chapterRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--border)',
  borderRadius: 6, marginBottom: 6, background: 'var(--bg-panel-2)',
}
const batchStreamBox: React.CSSProperties = {
  marginTop: 8,
  maxHeight: 220,
  overflow: 'auto',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg-panel-2)',
  padding: 8,
}
const batchStreamPre: React.CSSProperties = {
  margin: 0,
  maxHeight: 96,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'var(--mono)',
  fontSize: 11,
  lineHeight: 1.5,
  color: 'var(--text-dim)',
}
