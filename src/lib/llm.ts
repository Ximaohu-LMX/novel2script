import type { LLMConfig } from '../types'

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CallOptions {
  signal?: AbortSignal
  onToken?: (delta: string) => void  // 流式回调
}

/**
 * 统一的模型调用入口。
 * 目前完整实现 OpenAI 兼容协议(覆盖 OpenAI / 多数第三方端点),
 * Anthropic 走原生 messages 接口(留作扩展,基本可用)。
 */
export async function callLLM(
  config: LLMConfig,
  messages: ChatTurn[],
  options: CallOptions = {}
): Promise<string> {
  if (config.provider === 'anthropic') {
    return callAnthropic(config, messages, options)
  }
  return callOpenAICompatible(config, messages, options)
}

// ---------------- OpenAI 兼容 ----------------

async function callOpenAICompatible(
  config: LLMConfig,
  messages: ChatTurn[],
  options: CallOptions
): Promise<string> {
  const url = joinUrl(config.baseUrl, '/chat/completions')
  const res = await fetch(url, {
    method: 'POST',
    signal: options.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: config.temperature,
      stream: Boolean(options.onToken),
    }),
  })

  if (!res.ok) {
    throw new Error(`模型调用失败 (${res.status}): ${await safeText(res)}`)
  }

  if (options.onToken && res.body) {
    return readSSE(res.body, (json) => {
      const delta = json?.choices?.[0]?.delta?.content
      if (typeof delta === 'string') {
        options.onToken!(delta)
        return delta
      }
      return ''
    })
  }

  const data = await res.json()
  return data?.choices?.[0]?.message?.content ?? ''
}

// ---------------- Anthropic 原生 ----------------

async function callAnthropic(
  config: LLMConfig,
  messages: ChatTurn[],
  options: CallOptions
): Promise<string> {
  const url = joinUrl(config.baseUrl, '/v1/messages')
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
  const rest = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }))

  const res = await fetch(url, {
    method: 'POST',
    signal: options.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      // 允许浏览器直连(规避 CORS),用户需知晓 Key 暴露在前端
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: config.model,
      system: system || undefined,
      messages: rest,
      max_tokens: 4096,
      temperature: config.temperature,
      stream: Boolean(options.onToken),
    }),
  })

  if (!res.ok) {
    throw new Error(`模型调用失败 (${res.status}): ${await safeText(res)}`)
  }

  if (options.onToken && res.body) {
    return readSSE(res.body, (json) => {
      const delta = json?.delta?.text
      if (typeof delta === 'string') {
        options.onToken!(delta)
        return delta
      }
      return ''
    })
  }

  const data = await res.json()
  const block = data?.content?.find((b: any) => b.type === 'text')
  return block?.text ?? ''
}

// ---------------- 工具函数 ----------------

async function readSSE(
  body: ReadableStream<Uint8Array>,
  extract: (json: any) => string
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]' || !payload) continue
      try {
        full += extract(JSON.parse(payload))
      } catch {
        // 忽略非 JSON 的 keepalive 行
      }
    }
  }
  return full
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  // 若用户已在 baseUrl 写明完整路径(含 /chat/completions 或 /messages),直接用
  if (b.endsWith('/chat/completions') || b.endsWith('/messages')) return b
  // anthropic 的 /v1 已含在 path 中
  if (path.startsWith('/v1/') && b.endsWith('/v1')) {
    return b + path.slice(3)
  }
  return b + path
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300)
  } catch {
    return '无法读取错误详情'
  }
}
