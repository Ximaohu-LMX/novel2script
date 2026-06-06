import { useState, useEffect } from 'react'
import { useApp, newProject } from './store/useApp'
import { listProjects, loadProject, deleteProject } from './store/db'
import type { Project } from './types'
import Settings from './components/Settings'
import InputStage from './components/InputStage'
import BibleStage from './components/BibleStage'
import GenerateStage from './components/GenerateStage'

export default function App() {
  const { project, setProject, updateProject, llm, updateLlm } = useApp()
  const [showSettings, setShowSettings] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])

  const refresh = () => listProjects().then(setProjects)
  useEffect(() => { refresh() }, [project])

  const openProject = async (id: string) => {
    const p = await loadProject(id)
    if (p) setProject(p)
  }
  const create = () => {
    const name = prompt('项目名称:', '我的剧本') || '未命名'
    setProject(newProject(name))
  }
  const remove = async (id: string) => {
    if (confirm('确定删除该项目?')) { await deleteProject(id); refresh() }
  }

  const STAGES = [
    { key: 'input', label: '① 原文' },
    { key: 'bible', label: '② 设定' },
    { key: 'generate', label: '③ 剧本' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', position: 'relative', zIndex: 1 }}>
      {/* 头部 */}
      <header style={header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontFamily: 'var(--serif)', fontSize: 20, fontWeight: 900, color: 'var(--ink)' }}>墨改</span>
          <span className="faint" style={{ fontSize: 12 }}>AI 小说转剧本</span>
          {project && (
            <>
              <span className="faint">/</span>
              <span style={{ fontSize: 14 }}>{project.name}</span>
            </>
          )}
        </div>

        {project && (
          <div style={{ display: 'flex', gap: 4 }}>
            {STAGES.map((s) => (
              <button key={s.key}
                className={project.stage === s.key ? 'primary small' : 'ghost small'}
                onClick={() => updateProject((p) => ({ ...p, stage: s.key as Project['stage'] }))}>
                {s.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          {project && <button className="ghost small" onClick={() => setProject(null)}>项目列表</button>}
          <button className="ghost small" onClick={() => setShowSettings(true)}>
            ⚙ 模型设置 {!llm.apiKey && <span style={{ color: 'var(--danger)' }}>●</span>}
          </button>
        </div>
      </header>

      {/* 主体 */}
      <main style={{ flex: 1, overflow: 'hidden' }}>
        {!project ? (
          <ProjectList projects={projects} onCreate={create} onOpen={openProject} onDelete={remove} />
        ) : project.stage === 'input' ? (
          <div style={{ height: '100%', overflowY: 'auto' }}>
            <InputStage project={project} llm={llm} onUpdate={updateProject} />
          </div>
        ) : project.stage === 'bible' ? (
          <div style={{ height: '100%', overflowY: 'auto' }}>
            <BibleStage project={project} llm={llm} onUpdate={updateProject} />
          </div>
        ) : (
          <GenerateStage project={project} llm={llm} onUpdate={updateProject} />
        )}
      </main>

      {showSettings && <Settings config={llm} onSave={updateLlm} onClose={() => setShowSettings(false)} />}
    </div>
  )
}

function ProjectList({ projects, onCreate, onOpen, onDelete }: {
  projects: Project[]; onCreate: () => void; onOpen: (id: string) => void; onDelete: (id: string) => void
}) {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 26 }}>我的项目</h1>
        <button className="primary" onClick={onCreate}>+ 新建项目</button>
      </div>
      {projects.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60 }} className="muted">
          还没有项目。点击「新建项目」,粘贴你的小说开始改编。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {projects.map((p) => (
            <div key={p.id} style={projectCard}>
              <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => onOpen(p.id)}>
                <div style={{ fontFamily: 'var(--serif)', fontSize: 16, color: 'var(--ink)' }}>{p.name}</div>
                <div className="faint" style={{ fontSize: 12 }}>
                  {p.chapters.length} 章 · 阶段:{p.stage} · {new Date(p.updatedAt).toLocaleString('zh-CN')}
                </div>
              </div>
              <button className="ghost small danger" onClick={() => onDelete(p.id)}>删除</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const header: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '0 18px', height: 52, borderBottom: '1px solid var(--border)',
  background: 'var(--bg-panel)', flexShrink: 0,
}
const projectCard: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
  background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8,
}
