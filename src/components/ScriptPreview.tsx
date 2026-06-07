import { useEffect, useRef, useState } from 'react'
import yaml from 'js-yaml'
import type { Script, Scene, SceneElement } from '../types'
import { scriptToYaml } from '../lib/schema'

type EditableField = 'synopsis' | 'description' | 'line' | 'emotion'

interface EditTarget {
  sceneIndex: number
  elementIndex?: number
  field: EditableField
}

interface EditingTarget extends EditTarget {
  value: string
}

interface Props {
  yamlText: string
  charNames: Record<string, string>
  onChange?: (yamlText: string) => void
}

export default function ScriptPreview({ yamlText, charNames, onChange }: Props) {
  const [editing, setEditing] = useState<EditingTarget | null>(null)
  let script: Script | null = null
  let err = ''

  try {
    script = yaml.load(yamlText) as Script
  } catch (e: any) {
    err = e.message
  }

  if (err) return <div style={{ padding: 20, color: 'var(--danger)' }}>YAML 解析错误: {err}</div>
  if (!script || !script.scenes) return <div style={{ padding: 20 }} className="muted">暂无内容</div>

  const nameOf = (id?: string) => (id ? charNames[id] || id : '')
  const canEdit = Boolean(onChange)

  const beginEdit = (target: EditTarget, value?: string) => {
    if (!canEdit) return
    setEditing({ ...target, value: value ?? '' })
  }

  const cancelEdit = () => setEditing(null)

  const saveEdit = () => {
    if (!editing || !onChange || !script) return
    const next = updateScriptField(script, editing, editing.value)
    onChange(scriptToYaml(next))
    setEditing(null)
  }

  const changeDraft = (value: string) => {
    setEditing((current) => (current ? { ...current, value } : current))
  }

  return (
    <div style={{ padding: '24px 32px', fontFamily: 'var(--serif)', maxWidth: 680, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <h1 style={{ fontSize: 24 }}>{script.title}</h1>
        {script.logline && <p className="muted" style={{ fontSize: 13, marginTop: 6, fontFamily: 'var(--sans)' }}>{script.logline}</p>}
      </div>

      {script.scenes.map((scene: Scene, sceneIndex) => (
        <div key={scene.id || sceneIndex} style={{ marginBottom: 32 }}>
          <div style={sceneHeading}>
            {scene.heading?.location_type}. {scene.heading?.location} - {scene.heading?.time}
          </div>
          {scene.synopsis && (
            <EditableText
              value={scene.synopsis}
              editing={isEditing(editing, { sceneIndex, field: 'synopsis' })}
              draft={editing?.value ?? ''}
              multiline
              style={{ ...editableSynopsis, ...(canEdit ? editableCursor : null) }}
              onStart={() => beginEdit({ sceneIndex, field: 'synopsis' }, scene.synopsis)}
              onDraft={changeDraft}
              onSave={saveEdit}
              onCancel={cancelEdit}
            />
          )}
          {scene.elements?.map((el: SceneElement, elementIndex) => (
            <Element
              key={elementIndex}
              el={el}
              sceneIndex={sceneIndex}
              elementIndex={elementIndex}
              nameOf={nameOf}
              canEdit={canEdit}
              editing={editing}
              onBeginEdit={beginEdit}
              onDraft={changeDraft}
              onSave={saveEdit}
              onCancel={cancelEdit}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function Element({
  el,
  sceneIndex,
  elementIndex,
  nameOf,
  canEdit,
  editing,
  onBeginEdit,
  onDraft,
  onSave,
  onCancel,
}: {
  el: SceneElement
  sceneIndex: number
  elementIndex: number
  nameOf: (id?: string) => string
  canEdit: boolean
  editing: EditingTarget | null
  onBeginEdit: (target: EditTarget, value?: string) => void
  onDraft: (value: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  if (el.type === 'action') {
    const target = { sceneIndex, elementIndex, field: 'description' as const }
    return (
      <EditableText
        value={el.description ?? ''}
        editing={isEditing(editing, target)}
        draft={editing?.value ?? ''}
        multiline
        style={{ ...editableAction, ...(canEdit ? editableCursor : null) }}
        onStart={() => onBeginEdit(target, el.description)}
        onDraft={onDraft}
        onSave={onSave}
        onCancel={onCancel}
      />
    )
  }

  if (el.type === 'dialogue') {
    const lineTarget = { sceneIndex, elementIndex, field: 'line' as const }
    const emotionTarget = { sceneIndex, elementIndex, field: 'emotion' as const }
    return (
      <div style={{ margin: '0 auto 14px', textAlign: 'center', maxWidth: 420 }}>
        <div style={{ fontWeight: 700, color: 'var(--ink)', letterSpacing: 1 }}>{nameOf(el.character)}</div>
        {el.emotion && (
          <EditableText
            value={`(${el.emotion})`}
            editValue={el.emotion}
            editing={isEditing(editing, emotionTarget)}
            draft={editing?.value ?? ''}
            style={{ ...editableEmotion, ...(canEdit ? editableCursor : null) }}
            onStart={() => onBeginEdit(emotionTarget, el.emotion)}
            onDraft={onDraft}
            onSave={onSave}
            onCancel={onCancel}
          />
        )}
        <EditableText
          value={el.line ?? ''}
          editing={isEditing(editing, lineTarget)}
          draft={editing?.value ?? ''}
          multiline
          style={{ ...editableLine, ...(canEdit ? editableCursor : null) }}
          onStart={() => onBeginEdit(lineTarget, el.line)}
          onDraft={onDraft}
          onSave={onSave}
          onCancel={onCancel}
        />
      </div>
    )
  }

  if (el.type === 'parenthetical') {
    const target = { sceneIndex, elementIndex, field: 'description' as const }
    return (
      <EditableText
        value={`（${nameOf(el.character)}：${el.description ?? ''}）`}
        editValue={el.description ?? ''}
        editing={isEditing(editing, target)}
        draft={editing?.value ?? ''}
        style={{ ...editableParenthetical, ...(canEdit ? editableCursor : null) }}
        onStart={() => onBeginEdit(target, el.description)}
        onDraft={onDraft}
        onSave={onSave}
        onCancel={onCancel}
      />
    )
  }

  if (el.type === 'transition') {
    return <p style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-dim)', letterSpacing: 2, marginBottom: 12 }}>{el.transition}</p>
  }

  return null
}

function EditableText({
  value,
  editValue,
  editing,
  draft,
  multiline = false,
  style,
  onStart,
  onDraft,
  onSave,
  onCancel,
}: {
  value: string
  editValue?: string
  editing: boolean
  draft: string
  multiline?: boolean
  style: React.CSSProperties
  onStart: () => void
  onDraft: (value: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const skipBlurSaveRef = useRef(false)

  useEffect(() => {
    if (!editing) return
    ref.current?.focus()
    ref.current?.select()
  }, [editing])

  if (editing) {
    const common = {
      ref: ref as any,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onDraft(e.target.value),
      onBlur: () => {
        if (skipBlurSaveRef.current) {
          skipBlurSaveRef.current = false
          return
        }
        onSave()
      },
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          skipBlurSaveRef.current = true
          onCancel()
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          skipBlurSaveRef.current = true
          onSave()
        }
      },
      style: { ...inlineInput, minHeight: multiline ? 84 : undefined },
    }
    return multiline ? <textarea {...common} /> : <input {...common} />
  }

  return (
    <div
      role="button"
      tabIndex={0}
      title="点击编辑"
      style={style}
      onClick={onStart}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onStart()
        }
      }}
    >
      {value || editValue}
    </div>
  )
}

function isEditing(current: EditingTarget | null, target: EditTarget): boolean {
  return Boolean(
    current
    && current.sceneIndex === target.sceneIndex
    && current.elementIndex === target.elementIndex
    && current.field === target.field
  )
}

function updateScriptField(script: Script, target: EditTarget, value: string): Script {
  return {
    ...script,
    scenes: script.scenes.map((scene, sceneIndex) => {
      if (sceneIndex !== target.sceneIndex) return scene

      if (target.elementIndex === undefined) {
        return target.field === 'synopsis' ? { ...scene, synopsis: value } : scene
      }

      return {
        ...scene,
        elements: scene.elements.map((element, elementIndex) => (
          elementIndex === target.elementIndex ? { ...element, [target.field]: value } : element
        )),
      }
    }),
  }
}

const sceneHeading: React.CSSProperties = {
  fontWeight: 900,
  letterSpacing: 1,
  color: 'var(--ink-bright)',
  borderBottom: '1px solid var(--border)',
  paddingBottom: 6,
  marginBottom: 12,
  fontFamily: 'var(--sans)',
  fontSize: 14,
}

const editableCursor: React.CSSProperties = {
  cursor: 'text',
  borderRadius: 4,
}

const editableSynopsis: React.CSSProperties = {
  fontSize: 12,
  fontFamily: 'var(--sans)',
  fontStyle: 'italic',
  marginBottom: 12,
  color: 'var(--text-dim)',
}

const editableAction: React.CSSProperties = {
  marginBottom: 12,
  lineHeight: 1.7,
}

const editableLine: React.CSSProperties = {
  lineHeight: 1.6,
}

const editableEmotion: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--accent-bright)',
  fontFamily: 'var(--sans)',
}

const editableParenthetical: React.CSSProperties = {
  textAlign: 'center',
  fontSize: 12,
  color: 'var(--accent-bright)',
  marginBottom: 8,
}

const inlineInput: React.CSSProperties = {
  width: '100%',
  fontFamily: 'var(--sans)',
  fontSize: 13,
  lineHeight: 1.6,
  borderColor: 'var(--accent)',
  background: 'var(--bg-panel)',
}
