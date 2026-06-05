import { diffLines, type Change } from 'diff'
import yaml from 'js-yaml'
import type { BibleCharacter, CharacterRole } from '../types'

export type HunkStatus = 'pending' | 'accepted' | 'rejected'

export interface DiffReviewHunk {
  id: string
  oldStart: number
  newStart: number
  oldText: string
  newText: string
  status: HunkStatus
}

export type DiffReviewChunk =
  | { type: 'context'; text: string }
  | { type: 'hunk'; hunk: DiffReviewHunk }

export interface DiffReview {
  baseYaml: string
  proposedYaml: string
  explanation: string
  chunks: DiffReviewChunk[]
}

type DraftCharacter = Pick<BibleCharacter, 'id' | 'name' | 'role' | 'description' | 'traits'>

const ROLES: CharacterRole[] = ['protagonist', 'antagonist', 'supporting', 'minor']

export function createDiffReview(baseYaml: string, proposedYaml: string, explanation: string): DiffReview {
  const changes = diffLines(baseYaml || '', proposedYaml || '')
  const chunks: DiffReviewChunk[] = []
  let oldLine = 1
  let newLine = 1
  let current: DiffReviewHunk | null = null

  const flush = () => {
    if (!current) return
    chunks.push({ type: 'hunk', hunk: current })
    current = null
  }

  changes.forEach((change: Change, index: number) => {
    const lines = countLines(change.value)
    if (!change.added && !change.removed) {
      const next = changes[index + 1]
      if (current && next && (next.added || next.removed) && shouldMergeContext(change.value)) {
        current.oldText += change.value
        current.newText += change.value
        oldLine += lines
        newLine += lines
        return
      }
      flush()
      chunks.push({ type: 'context', text: change.value })
      oldLine += lines
      newLine += lines
      return
    }

    if (!current) {
      current = {
        id: `hunk_${chunks.filter((chunk) => chunk.type === 'hunk').length + 1}`,
        oldStart: oldLine,
        newStart: newLine,
        oldText: '',
        newText: '',
        status: 'pending',
      }
    }

    if (change.removed) {
      current.oldText += change.value
      oldLine += lines
    }
    if (change.added) {
      current.newText += change.value
      newLine += lines
    }
  })
  flush()

  return { baseYaml, proposedYaml, explanation, chunks }
}

export function composeDiffReview(
  review: DiffReview,
  overrides: Record<string, HunkStatus> = {}
): string {
  return review.chunks
    .map((chunk) => {
      if (chunk.type === 'context') return chunk.text
      const status = overrides[chunk.hunk.id] ?? chunk.hunk.status
      return status === 'accepted' ? chunk.hunk.newText : chunk.hunk.oldText
    })
    .join('')
}

export function setHunkStatus(review: DiffReview, hunkId: string, status: HunkStatus): DiffReview {
  return setHunkStatuses(review, [hunkId], status)
}

export function setHunkStatuses(review: DiffReview, hunkIds: string[], status: HunkStatus): DiffReview {
  const targets = new Set(hunkIds)
  return {
    ...review,
    chunks: review.chunks.map((chunk) => (
      chunk.type === 'hunk' && targets.has(chunk.hunk.id)
        ? { type: 'hunk', hunk: { ...chunk.hunk, status } }
        : chunk
    )),
  }
}

export function isReviewComplete(review: DiffReview): boolean {
  return review.chunks.every((chunk) => chunk.type === 'context' || chunk.hunk.status !== 'pending')
}

export function reviewHunks(review: DiffReview): DiffReviewHunk[] {
  return review.chunks.flatMap((chunk) => (chunk.type === 'hunk' ? [chunk.hunk] : []))
}

export function collectUnknownScriptCharacters(text: string, knownIds: Set<string>): DraftCharacter[] {
  let parsed: any
  try {
    parsed = yaml.load(text)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []

  const found = new Map<string, DraftCharacter>()
  const add = (id: unknown, source?: Partial<DraftCharacter>) => {
    if (typeof id !== 'string' || !id.trim() || knownIds.has(id)) return
    const existing = found.get(id)
    const next = normalizeCharacter({ id, ...existing, ...source })
    found.set(id, next)
  }

  if (Array.isArray(parsed.characters)) {
    parsed.characters.forEach((character: any) => {
      add(character?.id, {
        name: character?.name,
        role: character?.role,
        description: character?.description,
        traits: character?.traits,
      })
    })
  }

  if (Array.isArray(parsed.scenes)) {
    parsed.scenes.forEach((scene: any) => {
      if (Array.isArray(scene?.characters_present)) {
        scene.characters_present.forEach((id: unknown) => add(id))
      }
      if (Array.isArray(scene?.elements)) {
        scene.elements.forEach((element: any) => add(element?.character))
      }
    })
  }

  return Array.from(found.values())
}

export function mergeCharacterDraft(
  character: DraftCharacter,
  fallback?: DraftCharacter
): BibleCharacter {
  return {
    id: character.id,
    name: character.name || fallback?.name || character.id,
    aliases: [],
    role: character.role || fallback?.role || 'supporting',
    description: character.description || fallback?.description || '',
    traits: character.traits.length ? character.traits : fallback?.traits ?? [],
  }
}

function normalizeCharacter(character: Partial<DraftCharacter> & { id: string }): DraftCharacter {
  const role = ROLES.includes(character.role as CharacterRole)
    ? character.role as CharacterRole
    : 'supporting'
  return {
    id: character.id,
    name: typeof character.name === 'string' ? character.name : character.id,
    role,
    description: typeof character.description === 'string' ? character.description : '',
    traits: Array.isArray(character.traits)
      ? character.traits.filter((trait): trait is string => typeof trait === 'string' && Boolean(trait.trim()))
      : [],
  }
}

function countLines(value: string): number {
  if (!value) return 0
  return value.endsWith('\n') ? value.split('\n').length - 1 : value.split('\n').length
}

function shouldMergeContext(value: string): boolean {
  const lines = value.split('\n').filter(Boolean)
  if (lines.length > 8) return false
  return !lines.some((line) => (
    /^[a-z_]+:/.test(line)
    || /^  - id:\s*scene_/.test(line)
    || /^    chapter_ref:/.test(line)
    || /^    heading:/.test(line)
    || /^    elements:/.test(line)
    || /^      - type:/.test(line)
  ))
}
