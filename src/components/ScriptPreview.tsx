import yaml from 'js-yaml'
import type { Script, Scene, SceneElement } from '../types'

export default function ScriptPreview({ yamlText, charNames }: { yamlText: string; charNames: Record<string, string> }) {
  let script: Script | null = null
  let err = ''
  try {
    script = yaml.load(yamlText) as Script
  } catch (e: any) {
    err = e.message
  }

  if (err) return <div style={{ padding: 20, color: 'var(--danger)' }}>YAML 解析错误:{err}</div>
  if (!script || !script.scenes) return <div style={{ padding: 20 }} className="muted">暂无内容</div>

  const nameOf = (id?: string) => (id ? charNames[id] || id : '')

  return (
    <div style={{ padding: '24px 32px', fontFamily: 'var(--serif)', maxWidth: 680, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <h1 style={{ fontSize: 24 }}>{script.title}</h1>
        {script.logline && <p className="muted" style={{ fontSize: 13, marginTop: 6, fontFamily: 'var(--sans)' }}>{script.logline}</p>}
      </div>

      {script.scenes.map((scene: Scene, i) => (
        <div key={scene.id || i} style={{ marginBottom: 32 }}>
          <div style={sceneHeading}>
            {scene.heading?.location_type}. {scene.heading?.location} — {scene.heading?.time}
          </div>
          {scene.synopsis && (
            <p className="muted" style={{ fontSize: 12, fontFamily: 'var(--sans)', fontStyle: 'italic', marginBottom: 12 }}>
              {scene.synopsis}
            </p>
          )}
          {scene.elements?.map((el: SceneElement, j) => <Element key={j} el={el} nameOf={nameOf} />)}
        </div>
      ))}
    </div>
  )
}

function Element({ el, nameOf }: { el: SceneElement; nameOf: (id?: string) => string }) {
  if (el.type === 'action') {
    return <p style={{ marginBottom: 12, lineHeight: 1.7 }}>{el.description}</p>
  }
  if (el.type === 'dialogue') {
    return (
      <div style={{ margin: '0 auto 14px', textAlign: 'center', maxWidth: 420 }}>
        <div style={{ fontWeight: 700, color: 'var(--ink)', letterSpacing: 1 }}>{nameOf(el.character)}</div>
        {el.emotion && <div style={{ fontSize: 12, color: 'var(--accent-bright)', fontFamily: 'var(--sans)' }}>({el.emotion})</div>}
        <div style={{ lineHeight: 1.6 }}>{el.line}</div>
      </div>
    )
  }
  if (el.type === 'parenthetical') {
    return <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--accent-bright)', marginBottom: 8 }}>（{nameOf(el.character)}：{el.description}）</p>
  }
  if (el.type === 'transition') {
    return <p style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-dim)', letterSpacing: 2, marginBottom: 12 }}>{el.transition}</p>
  }
  return null
}

const sceneHeading: React.CSSProperties = {
  fontWeight: 900, letterSpacing: 1, color: 'var(--ink-bright)', borderBottom: '1px solid var(--border)',
  paddingBottom: 6, marginBottom: 12, fontFamily: 'var(--sans)', fontSize: 14,
}
