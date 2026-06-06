import { useState } from 'react'
import type { LLMConfig, Provider } from '../types'

interface Props {
  config: LLMConfig
  onSave: (c: LLMConfig) => void
  onClose: () => void
}

const PRESETS: Record<Provider, { baseUrl: string; model: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-20241022' },
}

export default function Settings({ config, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<LLMConfig>(config)
  const [providerDrafts, setProviderDrafts] = useState<Record<Provider, LLMConfig>>({
    openai: config.provider === 'openai'
      ? config
      : { ...config, provider: 'openai', baseUrl: PRESETS.openai.baseUrl, model: PRESETS.openai.model },
    anthropic: config.provider === 'anthropic'
      ? config
      : { ...config, provider: 'anthropic', baseUrl: PRESETS.anthropic.baseUrl, model: PRESETS.anthropic.model },
  })

  const set = <K extends keyof LLMConfig>(k: K, v: LLMConfig[K]) => {
    const next = { ...draft, [k]: v }
    setDraft(next)
    setProviderDrafts((all) => ({ ...all, [next.provider]: next }))
  }

  const switchProvider = (p: Provider) => {
    const currentSaved = { ...providerDrafts[draft.provider], ...draft }
    const next = providerDrafts[p] ?? { ...draft, provider: p, baseUrl: PRESETS[p].baseUrl, model: PRESETS[p].model }
    setProviderDrafts((all) => ({ ...all, [draft.provider]: currentSaved, [p]: next }))
    setDraft(next)
  }

  return (
    <div
      style={overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div style={modal} className="fade-in">
        <h2 style={{ fontSize: 20, marginBottom: 4 }}>模型设置</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 20 }}>
          API Key 仅保存在你本地浏览器,直连模型端点,不会上传到任何服务器。
        </p>

        <label className="label">服务商</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {(['openai', 'anthropic'] as Provider[]).map((p) => (
            <button
              key={p}
              className={draft.provider === p ? 'primary' : 'ghost'}
              onClick={() => switchProvider(p)}
              style={{ flex: 1 }}
            >
              {p === 'openai' ? 'OpenAI 兼容' : 'Anthropic'}
            </button>
          ))}
        </div>
        {draft.provider === 'anthropic' && (
          <p className="faint" style={{ fontSize: 11, marginBottom: 14 }}>
            注意:Anthropic 浏览器直连为实验性,部分网络环境可能受 CORS 限制。推荐优先使用 OpenAI 兼容端点。
          </p>
        )}

        <label className="label">Base URL</label>
        <input value={draft.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} style={{ marginBottom: 14 }} />

        <label className="label">API Key</label>
        <input
          type="password"
          value={draft.apiKey}
          placeholder="sk-..."
          onChange={(e) => set('apiKey', e.target.value)}
          style={{ marginBottom: 14 }}
        />

        <label className="label">模型名称</label>
        <input value={draft.model} onChange={(e) => set('model', e.target.value)} style={{ marginBottom: 14 }} />

        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <label className="label">温度 ({draft.temperature})</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={draft.temperature}
              onChange={(e) => set('temperature', Number(e.target.value))}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label className="label">批量并发数</label>
            <input
              type="number"
              min={1}
              max={5}
              value={draft.maxConcurrency}
              onChange={(e) => set('maxConcurrency', Number(e.target.value))}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="ghost" onClick={onClose}>取消</button>
          <button className="primary" onClick={() => { onSave(draft); onClose() }}>保存</button>
        </div>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
}
const modal: React.CSSProperties = {
  background: 'var(--bg-panel)', border: '1px solid var(--border-strong)', borderRadius: 12,
  padding: 28, width: 460, maxWidth: '90vw', boxShadow: 'var(--shadow)',
}
