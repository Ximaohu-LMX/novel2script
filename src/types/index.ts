// ============ 剧本 Schema 相关类型(对应设计文档锁定的 YAML Schema) ============

export type CharacterRole = 'protagonist' | 'antagonist' | 'supporting' | 'minor'
export type LocationType = 'INT' | 'EXT'
export type SceneTime = 'DAY' | 'NIGHT' | 'DAWN' | 'DUSK' | 'CONTINUOUS'
export type ElementType = 'action' | 'dialogue' | 'transition' | 'parenthetical'
export type TransitionType = 'CUT TO' | 'FADE OUT' | 'DISSOLVE TO'

export interface ScriptCharacter {
  id: string
  name: string
  role: CharacterRole
  description: string
  traits: string[]
}

export interface SceneHeading {
  location_type: LocationType
  location: string
  time: SceneTime
}

export interface SceneElement {
  type: ElementType
  description?: string        // action
  character?: string          // dialogue / parenthetical -> 人物 id
  line?: string               // dialogue
  emotion?: string            // dialogue 情绪/潜台词(可选)
  transition?: TransitionType // transition
}

export interface Scene {
  id: string
  chapter_ref: number
  heading: SceneHeading
  synopsis: string
  characters_present: string[]
  elements: SceneElement[]
}

export interface Script {
  title: string
  logline: string
  source: {
    novel_title: string
    total_chapters: number
  }
  characters: ScriptCharacter[]
  scenes: Scene[]
}

// ============ Story Bible(设定圣经) ============

export interface BibleCharacter {
  id: string
  name: string
  aliases: string[]
  role: CharacterRole
  description: string
  traits: string[]
}

export interface BibleLocation {
  id: string
  name: string
  description: string
}

export interface StoryBible {
  novelTitle: string
  logline: string
  characters: BibleCharacter[]
  locations: BibleLocation[]
  worldview: string   // 世界观/背景设定自由文本
}

// ============ 章节 ============

export interface Chapter {
  index: number       // 从 1 开始
  title: string
  summary: string     // AI 给出的一句话简述
  content: string     // 原文
}

// ============ 剧本风格配置 ============

export type ScriptStyle = 'screen' | 'stage' | 'storyboard'
export type DialogueDensity = 'sparse' | 'balanced' | 'dense'

export interface StyleConfig {
  style: ScriptStyle          // 影视剧 / 话剧 / 分镜脚本
  density: DialogueDensity    // 对白密度
  includeNarration: boolean   // 是否含旁白
}

// ============ LLM 配置 ============

export type Provider = 'openai' | 'anthropic'

export interface LLMConfig {
  provider: Provider
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxConcurrency: number
}

// ============ 版本管理(浏览器内类 Git) ============

export type CommitAuthor = 'user' | 'ai'

export interface Commit {
  id: string
  parent: string | null
  branch: string
  message: string
  author: CommitAuthor
  timestamp: number
  snapshot: string   // 该章节完整 YAML 快照
}

export interface ChapterVersioning {
  commits: Commit[]
  head: string | null              // 当前 HEAD commit id
  branches: Record<string, string> // branch 名 -> 最新 commit id
  currentBranch: string
  workingCopy: string              // 当前编辑中(未提交)的 YAML
}

// ============ 对话 ============

export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  pendingYaml?: string  // AI 提出的待审阅 YAML(接受后才 commit)
  timestamp: number
}

// ============ 章节生成状态 ============

export type ChapterStatus = 'pending' | 'generating' | 'done' | 'error'

export interface ChapterScriptState {
  chapterIndex: number
  status: ChapterStatus
  versioning: ChapterVersioning
  chat: ChatMessage[]
  error?: string
}

// ============ 项目 ============

export type ProjectStage = 'input' | 'bible' | 'generate'

export interface Project {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  stage: ProjectStage
  rawText: string
  chapters: Chapter[]
  bible: StoryBible | null
  styleConfig: StyleConfig
  chapterStates: Record<number, ChapterScriptState>
}
