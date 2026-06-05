import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Project, LLMConfig } from '../types'

interface AppDB extends DBSchema {
  projects: {
    key: string
    value: Project
  }
}

let dbPromise: Promise<IDBPDatabase<AppDB>> | null = null

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<AppDB>('novel2script', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' })
        }
      },
    })
  }
  return dbPromise
}

export async function saveProject(project: Project): Promise<void> {
  const db = await getDB()
  await db.put('projects', { ...project, updatedAt: Date.now() })
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const db = await getDB()
  return db.get('projects', id)
}

export async function listProjects(): Promise<Project[]> {
  const db = await getDB()
  const all = await db.getAll('projects')
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('projects', id)
}

// ---------------- LLM 配置(localStorage,含 API Key) ----------------

const LLM_KEY = 'novel2script.llm'

export const DEFAULT_LLM: LLMConfig = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxConcurrency: 2,
}

export function loadLLMConfig(): LLMConfig {
  try {
    const raw = localStorage.getItem(LLM_KEY)
    if (raw) return { ...DEFAULT_LLM, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return DEFAULT_LLM
}

export function saveLLMConfig(config: LLMConfig): void {
  localStorage.setItem(LLM_KEY, JSON.stringify(config))
}
