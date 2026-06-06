import { useState, useEffect, useCallback, useRef } from 'react'
import type { Project, LLMConfig, StyleConfig } from '../types'
import { saveProject, loadLLMConfig, saveLLMConfig, DEFAULT_LLM } from '../store/db'

const DEFAULT_STYLE: StyleConfig = {
  style: 'screen',
  density: 'balanced',
  includeNarration: false,
}

export function newProject(name: string): Project {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stage: 'input',
    rawText: '',
    chapters: [],
    bible: null,
    styleConfig: DEFAULT_STYLE,
    chapterStates: {},
  }
}

export function useApp() {
  const [project, setProject] = useState<Project | null>(null)
  const [llm, setLlm] = useState<LLMConfig>(DEFAULT_LLM)
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    setLlm(loadLLMConfig())
  }, [])

  // 防抖持久化项目
  useEffect(() => {
    if (!project) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveProject(project)
    }, 500)
  }, [project])

  const updateProject = useCallback((updater: (p: Project) => Project) => {
    setProject((prev) => (prev ? updater(prev) : prev))
  }, [])

  const updateLlm = useCallback((config: LLMConfig) => {
    setLlm(config)
    saveLLMConfig(config)
  }, [])

  return { project, setProject, updateProject, llm, updateLlm }
}
