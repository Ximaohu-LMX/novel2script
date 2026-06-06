import Ajv, { type ValidateFunction } from 'ajv'
import yaml from 'js-yaml'
import type { Script } from '../types'

// 对应设计文档锁定的剧本 Schema 的 JSON Schema 表达
export const scriptJsonSchema = {
  type: 'object',
  required: ['title', 'logline', 'source', 'characters', 'scenes'],
  properties: {
    title: { type: 'string' },
    logline: { type: 'string' },
    source: {
      type: 'object',
      required: ['novel_title', 'total_chapters'],
      properties: {
        novel_title: { type: 'string' },
        total_chapters: { type: 'integer' },
      },
    },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'role', 'description', 'traits'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          role: { enum: ['protagonist', 'antagonist', 'supporting', 'minor'] },
          description: { type: 'string' },
          traits: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'chapter_ref', 'heading', 'synopsis', 'characters_present', 'elements'],
        properties: {
          id: { type: 'string' },
          chapter_ref: { type: 'integer' },
          heading: {
            type: 'object',
            required: ['location_type', 'location', 'time'],
            properties: {
              location_type: { enum: ['INT', 'EXT'] },
              location: { type: 'string' },
              time: { enum: ['DAY', 'NIGHT', 'DAWN', 'DUSK', 'CONTINUOUS'] },
            },
          },
          synopsis: { type: 'string' },
          characters_present: { type: 'array', items: { type: 'string' } },
          elements: {
            type: 'array',
            items: {
              type: 'object',
              required: ['type'],
              properties: {
                type: { enum: ['action', 'dialogue', 'transition', 'parenthetical'] },
                description: { type: 'string' },
                character: { type: 'string' },
                line: { type: 'string' },
                emotion: { type: 'string' },
                transition: { enum: ['CUT TO', 'FADE OUT', 'DISSOLVE TO'] },
              },
            },
          },
        },
      },
    },
  },
} as const

const ajv = new Ajv({ allErrors: true, strict: false })
const validateFn: ValidateFunction = ajv.compile(scriptJsonSchema)

export interface ValidateResult {
  valid: boolean
  errors: string[]
  data?: Script
}

/** 解析并校验一段剧本 YAML */
export function validateScriptYaml(text: string): ValidateResult {
  let parsed: unknown
  try {
    parsed = yaml.load(text)
  } catch (e: any) {
    return { valid: false, errors: [`YAML 解析失败: ${e.message}`] }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { valid: false, errors: ['顶层结构不是对象'] }
  }
  const ok = validateFn(parsed)
  if (!ok) {
    const errors = (validateFn.errors ?? []).map(
      (e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim()
    )
    return { valid: false, errors }
  }
  return { valid: true, errors: [], data: parsed as Script }
}

export function scriptToYaml(script: Script): string {
  return yaml.dump(script, { lineWidth: -1, noRefs: true, sortKeys: false })
}

/** 从可能含 ```yaml 围栏或解释文字的模型输出里提取纯 YAML */
export function extractYaml(raw: string): string {
  const fenced = raw.match(/```(?:ya?ml)?\s*\n([\s\S]*?)```/i)
  if (fenced) return fenced[1].trim()
  return raw.trim()
}
