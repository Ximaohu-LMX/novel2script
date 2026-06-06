import { diffLines, type Change } from 'diff'
import type { ChapterVersioning, Commit, CommitAuthor } from '../types'

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function initVersioning(initialYaml = ''): ChapterVersioning {
  return {
    commits: [],
    head: null,
    branches: { main: '' },
    currentBranch: 'main',
    workingCopy: initialYaml,
  }
}

/** 提交一次,返回新的 versioning(不可变更新) */
export function commit(
  v: ChapterVersioning,
  yamlText: string,
  message: string,
  author: CommitAuthor
): ChapterVersioning {
  const id = uid()
  const newCommit: Commit = {
    id,
    parent: v.head,
    branch: v.currentBranch,
    message,
    author,
    timestamp: Date.now(),
    snapshot: yamlText,
  }
  return {
    ...v,
    commits: [...v.commits, newCommit],
    head: id,
    branches: { ...v.branches, [v.currentBranch]: id },
    workingCopy: yamlText,
  }
}

/** 检出某个 commit:HEAD 指向它,workingCopy 重置为其快照 */
export function checkout(v: ChapterVersioning, commitId: string): ChapterVersioning {
  const target = v.commits.find((c) => c.id === commitId)
  if (!target) return v
  return { ...v, head: commitId, workingCopy: target.snapshot }
}

/** 新建分支并切换 */
export function createBranch(v: ChapterVersioning, name: string): ChapterVersioning {
  if (v.branches[name]) return v
  return {
    ...v,
    branches: { ...v.branches, [name]: v.head ?? '' },
    currentBranch: name,
  }
}

export function switchBranch(v: ChapterVersioning, name: string): ChapterVersioning {
  const tip = v.branches[name]
  if (tip === undefined) return v
  const target = v.commits.find((c) => c.id === tip)
  return {
    ...v,
    currentBranch: name,
    head: tip || null,
    workingCopy: target?.snapshot ?? '',
  }
}

export function getCommit(v: ChapterVersioning, id: string): Commit | undefined {
  return v.commits.find((c) => c.id === id)
}

/** 当前 HEAD 快照与 workingCopy 是否有未提交改动 */
export function isDirty(v: ChapterVersioning): boolean {
  const head = v.head ? getCommit(v, v.head) : undefined
  return (head?.snapshot ?? '') !== v.workingCopy
}

export interface DiffSegment {
  value: string
  added?: boolean
  removed?: boolean
}

export function computeDiff(oldText: string, newText: string): DiffSegment[] {
  return diffLines(oldText || '', newText || '').map((c: Change) => ({
    value: c.value,
    added: c.added,
    removed: c.removed,
  }))
}

/** 按时间倒序返回提交,用于时间线展示 */
export function history(v: ChapterVersioning): Commit[] {
  return [...v.commits].sort((a, b) => b.timestamp - a.timestamp)
}
