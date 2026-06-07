import { useEffect, useRef, useState } from 'react'
import yaml from 'js-yaml'
import type { Script, Scene, SceneElement } from '../types'

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
    const next = replaceYamlField(yamlText, editing, editing.value)
    if (next) onChange(next)
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

function replaceYamlField(text: string, target: EditTarget, value: string): string | null {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const fieldLine = findTargetFieldLine(lines, target)
  if (fieldLine === null) return null

  const indent = countIndent(lines[fieldLine])
  const endLine = findScalarEndLine(lines, fieldLine, indent)
  const replacement = dumpFieldAtIndent(target.field, value, indent)
  lines.splice(fieldLine, endLine - fieldLine + 1, ...replacement)
  return lines.join(eol)
}

function findTargetFieldLine(lines: string[], target: EditTarget): number | null {
  const scenesLine = lines.findIndex((line) => /^\s*scenes\s*:/.test(line))
  if (scenesLine < 0) return null

  const scenesIndent = countIndent(lines[scenesLine])
  const scene = findListItemBlock(lines, scenesLine + 1, scenesIndent, target.sceneIndex)
  if (!scene) return null

  if (target.elementIndex === undefined) {
    return findFieldLine(lines, scene.start + 1, scene.end, scene.indent + 2, target.field)
  }

  const elementsLine = findFieldLine(lines, scene.start + 1, scene.end, scene.indent + 2, 'elements')
  if (elementsLine === null) return null

  const element = findListItemBlock(lines, elementsLine + 1, countIndent(lines[elementsLine]), target.elementIndex)
  if (!element || element.start > scene.end) return null

  return findFieldLine(lines, element.start + 1, element.end, element.indent + 2, target.field)
}

function findListItemBlock(
  lines: string[],
  from: number,
  containerIndent: number,
  targetIndex: number,
): { start: number; end: number; indent: number } | null {
  let seen = -1
  const itemIndent = containerIndent + 2

  for (let i = from; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim()) continue

    const indent = countIndent(line)
    if (indent <= containerIndent) break
    if (indent !== itemIndent || !isListItemAtIndent(line, itemIndent)) continue

    seen += 1
    if (seen !== targetIndex) continue

    return {
      start: i,
      end: findBlockEnd(lines, i, indent, containerIndent),
      indent,
    }
  }

  return null
}

function findBlockEnd(lines: string[], start: number, itemIndent: number, containerIndent: number): number {
  let end = start

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim()) {
      end = i
      continue
    }

    const indent = countIndent(line)
    if (indent <= containerIndent) break
    if (indent === itemIndent && isListItemAtIndent(line, indent)) break

    end = i
  }

  return end
}

function findFieldLine(lines: string[], from: number, to: number, indent: number, field: string): number | null {
  const pattern = new RegExp(`^ {${indent}}${escapeRegExp(field)}\\s*:`)
  for (let i = from; i <= to && i < lines.length; i += 1) {
    if (pattern.test(lines[i])) return i
  }
  return null
}

function findScalarEndLine(lines: string[], fieldLine: number, fieldIndent: number): number {
  const valuePart = lines[fieldLine].slice(lines[fieldLine].indexOf(':') + 1).trim()
  if (valuePart && !/^[|>]/.test(valuePart)) return fieldLine

  let end = fieldLine
  for (let i = fieldLine + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() && countIndent(line) <= fieldIndent) break
    end = i
  }
  return end
}

function dumpFieldAtIndent(field: string, value: string, indent: number): string[] {
  const dumped = yaml.dump({ [field]: value }, { lineWidth: -1, noRefs: true, sortKeys: false }).trimEnd()
  const prefix = ' '.repeat(indent)
  return dumped.split('\n').map((line) => `${prefix}${line}`)
}

function isListItemAtIndent(line: string, indent: number): boolean {
  return countIndent(line) === indent && line.slice(indent).startsWith('- ')
}

function countIndent(line: string): number {
  const match = line.match(/^ */)
  return match ? match[0].length : 0
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
