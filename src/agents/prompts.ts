import type { StoryBible, StyleConfig, Chapter, ScriptStyle, DialogueDensity } from '../types'

const STYLE_LABEL: Record<ScriptStyle, string> = {
  screen: '影视剧剧本(标准影视分场,含场景标题 INT./EXT.、动作描述、对白)',
  stage: '话剧剧本(以舞台为单位,侧重对白与舞台指示,场景切换较少)',
  storyboard: '分镜脚本(以镜头为单位,强调画面、景别、动作的视觉化描述)',
}

const DENSITY_LABEL: Record<DialogueDensity, string> = {
  sparse: '对白精简,多用动作和画面推进剧情',
  balanced: '对白与动作均衡',
  dense: '对白密集,以人物对话为主要叙事手段',
}

/** 切分 Agent 的 prompt */
export function buildSplitPrompt(rawText: string): { system: string; user: string } {
  const system = `你是剧本改编的预处理助手。你的任务是把一段中文小说原文切分为若干章节,并为每章给出标题与一句话简述。
要求:
- 优先依据原文中已有的章节标记(如"第X章""Chapter X")切分;若无明显标记,则按剧情段落合理切分。
- 每章简述控制在 30 字以内,概括该章核心事件。
- 严格只输出 JSON,不要任何解释文字或 Markdown 围栏。
输出格式:
{"chapters":[{"index":1,"title":"章节标题","summary":"一句话简述","startMarker":"该章开头的前15个字"}]}`
  const user = `请切分以下小说原文:\n\n${rawText}`
  return { system, user }
}

/** Story Bible 抽取 Agent 的 prompt(对单个分块) */
export function buildBiblePrompt(chunk: string): { system: string; user: string } {
  const system = `你是剧本改编的设定分析助手。请从给定的小说文本片段中抽取人物、场景地点与世界观设定。
要求:
- 人物:给出名字、可能的别称、角色定位(protagonist主角/antagonist反派/supporting配角/minor龙套)、外貌性格描述、性格特征标签。
- 地点:按"大场景/小场景"层级整理。大场景是宅邸、学校、城市街区等稳定空间;小场景是书房、走廊、咖啡馆包间等具体可拍摄空间。若无法细分,subLocations 为空数组。
- 世界观:背景设定、时代、特殊规则等(若有)。
- 严格只输出 JSON,不要解释文字或 Markdown 围栏。
输出格式:
{"characters":[{"name":"","aliases":[],"role":"supporting","description":"","traits":[]}],"locations":[{"name":"","description":"","subLocations":[{"name":"","description":""}]}],"worldview":""}`
  const user = `请分析以下文本片段:\n\n${chunk}`
  return { system, user }
}

/** 剧本生成 Agent 的 prompt */
export function buildScriptPrompt(
  chapter: Chapter,
  bible: StoryBible,
  style: StyleConfig,
  prevSummary: string
): { system: string; user: string } {
  const activeCharacters = bible.characters.filter((c) => !c.deprecated)
  const activeLocations = bible.locations.filter((location) => !location.deprecated)
  const charList = activeCharacters
    .map((c) => `  - id: ${c.id} | ${c.name}(${c.role})${c.aliases.length ? ' 别称:' + c.aliases.join('、') : ''}`)
    .join('\n')
  const locationList = activeLocations.length
    ? activeLocations.map((location) => {
      const subs = location.subLocations ?? []
      if (!subs.length) return `  - ${location.name}: ${location.description || '无描述'}`
      return [
        `  - ${location.name}: ${location.description || '无描述'}`,
        ...subs.map((sub) => `    - ${location.name}-${sub.name}: ${sub.description || '无描述'}`),
      ].join('\n')
    }).join('\n')
    : '  (无预设地点)'

  const system = `你是专业的剧本改编编剧。请将给定的小说章节改编为结构化剧本,并以严格的 YAML 输出。

【剧本风格】${STYLE_LABEL[style.style]}
【对白密度】${DENSITY_LABEL[style.density]}
【旁白】${style.includeNarration ? '可使用旁白(作为 action 元素,description 前缀"旁白:")' : '不使用旁白'}

【必须遵守的 YAML Schema】
title: 剧本标题(字符串)
logline: 一句话故事梗概
source:
  novel_title: 原著名
  total_chapters: 原著总章数(整数)
characters: 全局人物表
  - id: 人物唯一标识(用下方提供的 id)
    name: 姓名
    role: protagonist|antagonist|supporting|minor
    description: 描述
    traits: [特征标签数组]
scenes: 场景序列
  - id: 场景id(如 scene_001)
    chapter_ref: 来源章节号(整数)
    heading:
      location_type: INT 或 EXT
      location: 地点名
      time: DAY|NIGHT|DAWN|DUSK|CONTINUOUS
    synopsis: 本场景剧情概要
    characters_present: [出场人物 id 数组]
    elements: 有序事件流
      - type: action      # 动作/画面
        description: 描述文字
      - type: dialogue    # 对白
        character: 人物 id
        line: 台词
        emotion: 情绪或潜台词(可选)
      - type: parenthetical  # 表演提示(可选)
        character: 人物 id
        description: 提示文字
      - type: transition  # 转场(可选)
        transition: CUT TO|FADE OUT|DISSOLVE TO

【硬性要求】
- 人物 id 必须使用下方设定提供的 id,不要自创新人物 id。
- 场景标题 heading.location 必须优先从下方地点层级中选用并保持命名统一:有小场景时写"大场景-小场景"(如"林家宅邸-书房"),没有小场景时只写大场景名。
- 一个章节可拆成多个场景。
- 严格只输出合法 YAML,不要任何解释文字。可以用 \`\`\`yaml 围栏包裹。
- 所有对白和描述使用中文。`

  const user = `【全局设定 · 人物表】
${charList}

【全局设定 · 地点层级】
${locationList}

【世界观】
${bible.worldview || '(无特别设定)'}

${prevSummary ? `【上一章剧情概要(用于衔接)】\n${prevSummary}\n` : ''}
【本章原文】(第 ${chapter.index} 章:${chapter.title})
${chapter.content}

请将本章改编为剧本 YAML。title 用"${bible.novelTitle}",source.novel_title 用"${bible.novelTitle}",source.total_chapters 用实际原著章数。scenes 的 chapter_ref 均为 ${chapter.index}。`
  return { system, user }
}

/** 对话式编辑 Agent 的 prompt */
export function buildEditPrompt(
  currentYaml: string,
  instruction: string,
  bible: StoryBible
): { system: string; user: string } {
  const charList = bible.characters.filter((c) => !c.deprecated).map((c) => `${c.id}=${c.name}`).join(', ')
  const system = `你是剧本编辑助手。用户会给你一段现有的剧本章节 YAML 和一条修改指令。
请根据指令修改剧本,并输出【修改后的完整章节 YAML】(不是 diff,是完整内容)。
要求:
- 严格保持原 Schema 结构与字段。
- 人物 id 保持不变(参考:${charList})。
- 只改动指令涉及的部分,其余尽量保留。
- 先用一行"【改动说明】xxx"简述你改了什么,然后用 \`\`\`yaml 围栏输出完整 YAML。`
  const user = `【当前剧本 YAML】
\`\`\`yaml
${currentYaml}
\`\`\`

【修改指令】
${instruction}`
  return { system, user }
}

/** 校验失败时的自修复 prompt */
export function buildRepairPrompt(badYaml: string, errors: string[]): { system: string; user: string } {
  const system = `你是 YAML 修复助手。下面的剧本 YAML 未通过 Schema 校验,请修复后输出完整的合法 YAML(用 \`\`\`yaml 围栏),不要解释。`
  const user = `【校验错误】\n${errors.join('\n')}\n\n【待修复 YAML】\n\`\`\`yaml\n${badYaml}\n\`\`\``
  return { system, user }
}
