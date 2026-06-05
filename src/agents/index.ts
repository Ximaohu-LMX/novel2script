import type { Chapter, StoryBible, StyleConfig, LLMConfig, BibleCharacter, CharacterRole } from '../types'
import { callLLM } from '../lib/llm'
import { validateScriptYaml, extractYaml } from '../lib/schema'
import {
  buildSplitPrompt,
  buildBiblePrompt,
  buildScriptPrompt,
  buildEditPrompt,
  buildRepairPrompt,
} from './prompts'

// ---------- 工具:解析模型返回的 JSON(容错围栏/前后缀) ----------
function parseJson<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('未找到 JSON 内容')
  return JSON.parse(body.slice(start, end + 1)) as T
}

function slugCharId(name: string, i: number): string {
  return `char_${i + 1}`
}

// ============ 1. 切分 Agent ============

export async function splitChapters(rawText: string, config: LLMConfig): Promise<Chapter[]> {
  const { system, user } = buildSplitPrompt(rawText)
  const out = await callLLM(config, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ])
  const parsed = parseJson<{ chapters: { index: number; title: string; summary: string; startMarker: string }[] }>(out)

  // 用 startMarker 把原文切回每章 content
  const markers = parsed.chapters
  const chapters: Chapter[] = []
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i]
    const startIdx = m.startMarker ? rawText.indexOf(m.startMarker.slice(0, 15)) : -1
    const nextMarker = markers[i + 1]?.startMarker?.slice(0, 15)
    const endIdx = nextMarker ? rawText.indexOf(nextMarker) : rawText.length
    const content =
      startIdx >= 0 && endIdx > startIdx
        ? rawText.slice(startIdx, endIdx).trim()
        : '' // 兜底:切不准时留空,后续可手动补
    chapters.push({
      index: m.index ?? i + 1,
      title: m.title ?? `第${i + 1}章`,
      summary: m.summary ?? '',
      content: content || rawText, // 极端兜底
    })
  }
  // 若只切出 1 章但原文较长,退化为整篇
  return chapters.length ? chapters : [{ index: 1, title: '全文', summary: '', content: rawText }]
}

// ============ 2. Story Bible 抽取(map-reduce) ============

interface RawBible {
  characters: { name: string; aliases: string[]; role: string; description: string; traits: string[] }[]
  locations: { name: string; description: string }[]
  worldview: string
}

function chunkText(chapters: Chapter[], maxLen = 6000): string[] {
  const chunks: string[] = []
  let cur = ''
  for (const ch of chapters) {
    const piece = `【第${ch.index}章 ${ch.title}】\n${ch.content}\n`
    if (cur.length + piece.length > maxLen && cur) {
      chunks.push(cur)
      cur = ''
    }
    cur += piece
  }
  if (cur) chunks.push(cur)
  return chunks
}

export async function extractBible(
  chapters: Chapter[],
  novelTitle: string,
  config: LLMConfig
): Promise<StoryBible> {
  const chunks = chunkText(chapters)

  // map:逐块抽取
  const partials: RawBible[] = []
  for (const chunk of chunks) {
    const { system, user } = buildBiblePrompt(chunk)
    const out = await callLLM(config, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ])
    try {
      partials.push(parseJson<RawBible>(out))
    } catch {
      // 单块失败不致命,跳过
    }
  }

  // reduce:合并去重
  const charMap = new Map<string, BibleCharacter>()
  const locMap = new Map<string, { name: string; description: string }>()
  let worldview = ''

  const normalizeRole = (r: string): CharacterRole => {
    const v = (r || '').toLowerCase()
    if (v.includes('protagon')) return 'protagonist'
    if (v.includes('antagon')) return 'antagonist'
    if (v.includes('minor')) return 'minor'
    return 'supporting'
  }

  for (const p of partials) {
    for (const c of p.characters ?? []) {
      const key = c.name?.trim()
      if (!key) continue
      const existing = charMap.get(key)
      if (existing) {
        existing.aliases = Array.from(new Set([...existing.aliases, ...(c.aliases ?? [])]))
        existing.traits = Array.from(new Set([...existing.traits, ...(c.traits ?? [])]))
        if (c.description && c.description.length > existing.description.length) {
          existing.description = c.description
        }
      } else {
        charMap.set(key, {
          id: '',
          name: key,
          aliases: c.aliases ?? [],
          role: normalizeRole(c.role),
          description: c.description ?? '',
          traits: c.traits ?? [],
        })
      }
    }
    for (const l of p.locations ?? []) {
      const key = l.name?.trim()
      if (key && !locMap.has(key)) locMap.set(key, { name: key, description: l.description ?? '' })
    }
    if (p.worldview && p.worldview.length > worldview.length) worldview = p.worldview
  }

  const characters = Array.from(charMap.values()).map((c, i) => ({ ...c, id: slugCharId(c.name, i) }))
  const locations = Array.from(locMap.values()).map((l, i) => ({ id: `loc_${i + 1}`, ...l }))

  return {
    novelTitle,
    logline: '',
    characters,
    locations,
    worldview,
  }
}

// ============ 3. 剧本生成 Agent(含自修复) ============

export async function generateScript(
  chapter: Chapter,
  bible: StoryBible,
  style: StyleConfig,
  prevSummary: string,
  config: LLMConfig,
  onToken?: (t: string) => void
): Promise<{ yaml: string; valid: boolean; errors: string[] }> {
  const { system, user } = buildScriptPrompt(chapter, bible, style, prevSummary)
  let raw = await callLLM(
    config,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { onToken }
  )
  let yamlText = extractYaml(raw)
  let result = validateScriptYaml(yamlText)

  // 自修复一次
  if (!result.valid) {
    const { system: rs, user: ru } = buildRepairPrompt(yamlText, result.errors)
    raw = await callLLM(config, [
      { role: 'system', content: rs },
      { role: 'user', content: ru },
    ])
    yamlText = extractYaml(raw)
    result = validateScriptYaml(yamlText)
  }

  return { yaml: yamlText, valid: result.valid, errors: result.errors }
}

// ============ 4. 对话编辑 Agent ============

export async function editScript(
  currentYaml: string,
  instruction: string,
  bible: StoryBible,
  config: LLMConfig,
  onToken?: (t: string) => void
): Promise<{ explanation: string; yaml: string; valid: boolean; errors: string[] }> {
  const { system, user } = buildEditPrompt(currentYaml, instruction, bible)
  const raw = await callLLM(
    config,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { onToken }
  )
  // 提取改动说明
  const expMatch = raw.match(/【改动说明】(.*)/)
  const explanation = expMatch ? expMatch[1].trim() : '已根据指令修改。'
  let yamlText = extractYaml(raw)
  let result = validateScriptYaml(yamlText)

  if (!result.valid) {
    const { system: rs, user: ru } = buildRepairPrompt(yamlText, result.errors)
    const repaired = await callLLM(config, [
      { role: 'system', content: rs },
      { role: 'user', content: ru },
    ])
    yamlText = extractYaml(repaired)
    result = validateScriptYaml(yamlText)
  }

  return { explanation, yaml: yamlText, valid: result.valid, errors: result.errors }
}
