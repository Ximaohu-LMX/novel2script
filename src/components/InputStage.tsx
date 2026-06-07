import { useState } from 'react'
import type { Project, LLMConfig } from '../types'
import { splitChapters } from '../agents'

interface Props {
  project: Project
  llm: LLMConfig
  onUpdate: (updater: (p: Project) => Project) => void
}

const SAMPLE = `第一章 归乡
林深回到阔别十年的雾城时,正下着冷雨。他站在废弃的私家侦探事务所门前,锁孔里插着一把不属于他的钥匙。推门进去,桌上落满灰尘,唯独一封信干净如新,收信人写着他的名字。
"我应该来过这里。"他喃喃自语,却想不起任何片段。十年前那场让他失忆的车祸,夺走的不只是记忆。

第二章 旧识
苏晚在咖啡馆找到他。她说她是他从前的助手,知道他在查一桩悬案。"你当年离真相只差一步,"她搅动着咖啡,"然后你就出事了。"林深盯着她,总觉得这个女人的眼神里藏着什么。

第三章 真相的边缘
档案室深夜的灯光下,林深翻出尘封的卷宗。照片里的凶手背影,穿着和他此刻一模一样的风衣。他的手开始发抖——那个被所有人追查的凶手,会不会就是失忆前的自己?`

export default function InputStage({ project, llm, onUpdate }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expandedChapter, setExpandedChapter] = useState<number | null>(null)

  const canSplit = project.rawText.trim().length > 50 && llm.apiKey

  const updateChapter = (index: number, patch: Partial<Project['chapters'][number]>) =>
    onUpdate((p) => ({
      ...p,
      chapters: p.chapters.map((c) => (c.index === index ? { ...c, ...patch } : c)),
    }))

  const handleSplit = async () => {
    setBusy(true)
    setError('')
    try {
      const chapters = await splitChapters(project.rawText, llm)
      onUpdate((p) => ({ ...p, chapters }))
    } catch (e: any) {
      setError(e.message || '切分失败')
    } finally {
      setBusy(false)
    }
  }

  const proceed = () => onUpdate((p) => ({ ...p, stage: 'bible' }))

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>① 粘贴小说原文</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        粘贴 3 章以上的小说文本,AI 将自动切分章节并生成简述。
      </p>

      <textarea
        value={project.rawText}
        onChange={(e) => onUpdate((p) => ({ ...p, rawText: e.target.value }))}
        placeholder="在此粘贴小说原文……"
        style={{ minHeight: 240, fontFamily: 'var(--serif)', fontSize: 15 }}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button className="primary" disabled={!canSplit || busy} onClick={handleSplit}>
          {busy ? <><span className="spinner" /> &nbsp;切分中…</> : 'AI 切分章节'}
        </button>
        <button className="ghost" onClick={() => onUpdate((p) => ({ ...p, rawText: SAMPLE }))}>
          载入示例
        </button>
        {!llm.apiKey && <span className="faint" style={{ fontSize: 12 }}>请先在右上角设置 API Key</span>}
        {error && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</span>}
      </div>

      {project.chapters.length > 0 && (
        <div className="fade-in" style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>切分结果 · {project.chapters.length} 章</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {project.chapters.map((ch) => {
              const isExpanded = expandedChapter === ch.index
              return (
                <div key={ch.index} style={chapterCard}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span style={{ fontFamily: 'var(--serif)', color: 'var(--ink)', fontWeight: 700 }}>
                      第 {ch.index} 章
                    </span>
                    <input
                      value={ch.title}
                      onChange={(e) => updateChapter(ch.index, { title: e.target.value })}
                      style={{ flex: 1, background: 'transparent', border: 'none', fontWeight: 500 }}
                    />
                    <span className="faint" style={{ fontSize: 11 }}>{ch.content.length} 字</span>
                    <button
                      className="ghost small"
                      onClick={() => setExpandedChapter(isExpanded ? null : ch.index)}
                    >
                      {isExpanded ? '收起' : '查看'}
                    </button>
                  </div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{ch.summary}</p>
                  {isExpanded && (
                    <div style={chapterDetail}>
                      <label className="label">标题</label>
                      <input
                        value={ch.title}
                        onChange={(e) => updateChapter(ch.index, { title: e.target.value })}
                        style={{ marginBottom: 10 }}
                      />
                      <label className="label">一句话摘要</label>
                      <input
                        value={ch.summary}
                        onChange={(e) => updateChapter(ch.index, { summary: e.target.value })}
                        style={{ marginBottom: 10 }}
                      />
                      <label className="label">正文</label>
                      <textarea
                        value={ch.content}
                        onChange={(e) => updateChapter(ch.index, { content: e.target.value })}
                        style={{ minHeight: 180, fontFamily: 'var(--serif)', fontSize: 14 }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <button className="primary" style={{ marginTop: 16 }} onClick={proceed}>
            确认章节,进入设定分析 →
          </button>
        </div>
      )}
    </div>
  )
}

const chapterCard: React.CSSProperties = {
  background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px',
}

const chapterDetail: React.CSSProperties = {
  marginTop: 12,
  paddingTop: 12,
  borderTop: '1px solid var(--border)',
}
