import yaml from 'js-yaml'
import type { Project, Script, Scene, SceneElement } from '../types'
import { scriptToYaml } from './schema'

export type ReferenceKind = 'character' | 'location' | 'text'

export interface ReferenceTarget {
  kind: ReferenceKind
  value: string
  includeText?: boolean
}

export interface ScriptReference {
  chapterIndex: number
  chapterTitle: string
  sceneId?: string
  sceneIndex?: number
  elementIndex?: number
  field: string
  text: string
  path: string
}

export interface TextReplacement {
  chapterIndex: number
  path: string
  from: string
  to: string
}

const TEXT_FIELDS = ['title', 'logline'] as const
const SCENE_TEXT_FIELDS = ['synopsis'] as const
const ELEMENT_TEXT_FIELDS = ['description', 'line', 'emotion'] as const

export function findProjectReferences(project: Project, target: ReferenceTarget): ScriptReference[] {
  const refs: ScriptReference[] = []
  for (const chapter of project.chapters) {
    const text = project.chapterStates[chapter.index]?.versioning.workingCopy
    if (!text?.trim()) continue
    const script = parseScript(text)
    if (!script) continue

    if (target.kind === 'character') {
      script.characters?.forEach((character, index) => {
        if (character.id === target.value) {
          refs.push(makeRef(chapter, undefined, undefined, `characters[${index}].id`, character.id, `/characters/${index}/id`))
        }
      })
    }

    TEXT_FIELDS.forEach((field) => {
      const value = script[field]
      if (target.includeText && typeof value === 'string' && value.includes(target.value)) {
        refs.push(makeRef(chapter, undefined, undefined, field, value, `/${field}`))
      }
    })

    script.scenes?.forEach((scene, sceneIndex) => {
      collectSceneReferences(refs, chapter, scene, sceneIndex, target)
    })
  }
  return refs
}

export function replaceProjectTextReferences(
  project: Project,
  replacements: TextReplacement[]
): Record<number, string> {
  const byChapter = new Map<number, TextReplacement[]>()
  replacements.forEach((replacement) => {
    const items = byChapter.get(replacement.chapterIndex) ?? []
    items.push(replacement)
    byChapter.set(replacement.chapterIndex, items)
  })

  const result: Record<number, string> = {}
  byChapter.forEach((items, chapterIndex) => {
    const source = project.chapterStates[chapterIndex]?.versioning.workingCopy
    const script = parseScript(source)
    if (!script) return

    items.forEach((replacement) => {
      replaceAtPath(script, replacement.path, replacement.from, replacement.to)
    })
    result[chapterIndex] = scriptToYaml(script)
  })
  return result
}

function collectSceneReferences(
  refs: ScriptReference[],
  chapter: Project['chapters'][number],
  scene: Scene,
  sceneIndex: number,
  target: ReferenceTarget
) {
  if (target.kind === 'location' && scene.heading?.location === target.value) {
    refs.push(makeRef(chapter, scene, sceneIndex, 'heading.location', scene.heading.location, `/scenes/${sceneIndex}/heading/location`))
  }

  if (target.includeText && target.kind === 'location' && scene.heading?.location?.includes(target.value)) {
    refs.push(makeRef(chapter, scene, sceneIndex, 'heading.location', scene.heading.location, `/scenes/${sceneIndex}/heading/location`))
  }

  if (target.kind === 'character' && Array.isArray(scene.characters_present)) {
    scene.characters_present.forEach((id, index) => {
      if (id === target.value) {
        refs.push(makeRef(chapter, scene, sceneIndex, `characters_present[${index}]`, id, `/scenes/${sceneIndex}/characters_present/${index}`))
      }
    })
  }

  SCENE_TEXT_FIELDS.forEach((field) => {
    const value = scene[field]
    if (target.includeText && typeof value === 'string' && value.includes(target.value)) {
      refs.push(makeRef(chapter, scene, sceneIndex, field, value, `/scenes/${sceneIndex}/${field}`))
    }
  })

  scene.elements?.forEach((element, elementIndex) => {
    collectElementReferences(refs, chapter, scene, sceneIndex, element, elementIndex, target)
  })
}

function collectElementReferences(
  refs: ScriptReference[],
  chapter: Project['chapters'][number],
  scene: Scene,
  sceneIndex: number,
  element: SceneElement,
  elementIndex: number,
  target: ReferenceTarget
) {
  if (target.kind === 'character' && element.character === target.value) {
    refs.push(makeRef(
      chapter,
      scene,
      sceneIndex,
      'element.character',
      element.character,
      `/scenes/${sceneIndex}/elements/${elementIndex}/character`,
      elementIndex
    ))
  }

  ELEMENT_TEXT_FIELDS.forEach((field) => {
    const value = element[field]
    if (target.includeText && typeof value === 'string' && value.includes(target.value)) {
      refs.push(makeRef(
        chapter,
        scene,
        sceneIndex,
        `element.${field}`,
        value,
        `/scenes/${sceneIndex}/elements/${elementIndex}/${field}`,
        elementIndex
      ))
    }
  })
}

function parseScript(text?: string): Script | null {
  if (!text?.trim()) return null
  try {
    const parsed = yaml.load(text)
    return parsed && typeof parsed === 'object' ? parsed as Script : null
  } catch {
    return null
  }
}

function makeRef(
  chapter: Project['chapters'][number],
  scene: Scene | undefined,
  sceneIndex: number | undefined,
  field: string,
  text: string,
  path: string,
  elementIndex?: number
): ScriptReference {
  return {
    chapterIndex: chapter.index,
    chapterTitle: chapter.title,
    sceneId: scene?.id,
    sceneIndex,
    elementIndex,
    field,
    text,
    path,
  }
}

function replaceAtPath(script: Script, path: string, from: string, to: string) {
  const parts = path.split('/').filter(Boolean)
  let current: any = script
  for (let i = 0; i < parts.length - 1; i++) {
    current = current?.[toKey(parts[i])]
    if (current === undefined || current === null) return
  }
  const last = toKey(parts[parts.length - 1])
  if (typeof current?.[last] === 'string') {
    current[last] = current[last].split(from).join(to)
  }
}

function toKey(part: string): string | number {
  return /^\d+$/.test(part) ? Number(part) : part
}
