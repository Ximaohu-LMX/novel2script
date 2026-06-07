# 剧本 YAML Schema 定义文档

本文件定义「墨改」工具输出的剧本 YAML 结构，并说明每项设计的原因。配套的机器可校验版本见 [`schema.json`](schema.json)（JSON Schema，应用内用 ajv 实时校验）。

---

## 一、设计目标与原则

本 Schema 用于描述由小说改编而来的剧本，遵循四条原则：

1. **结构化与可读性平衡**：YAML 既能被程序解析校验，又对作者足够友好，便于手动打磨。
2. **贴合剧本工业惯例**：字段映射到标准剧本要素（场景标题、动作、对白、转场），便于后续对接专业排版软件。
3. **保留可追溯性**：每个场景关联原文章节，方便作者对照原著修改。
4. **分层组织**：顶层是剧本元信息与全局设定，下层按场景（Scene）组织，符合「剧本由场景构成」的本质。

---

## 二、Schema 总览结构

```yaml
title: string                  # 剧本标题
logline: string                # 一句话故事梗概
source:                        # 原著信息
  novel_title: string
  total_chapters: int

characters:                    # 全局人物表(来自 Story Bible)
  - id: string                 # 人物唯一标识
    name: string
    role: protagonist | antagonist | supporting | minor
    description: string
    traits: [string]

scenes:                        # 剧本主体:场景序列
  - id: string
    chapter_ref: int           # 来源章节,保证可追溯
    heading:                   # 场景标题(行业惯例)
      location_type: INT | EXT # 内景/外景
      location: string
      time: DAY | NIGHT | DAWN | DUSK | CONTINUOUS
    synopsis: string           # 本场景剧情概要
    characters_present: [string]   # 出场人物 id
    elements:                  # 场景内的有序事件流
      - type: action | dialogue | transition | parenthetical
        # type=action:
        description: string
        # type=dialogue:
        character: string      # 人物 id
        line: string
        emotion: string        # 情绪/潜台词提示(可选)
        # type=parenthetical:
        # character + description
        # type=transition:
        transition: CUT TO | FADE OUT | DISSOLVE TO
```

---

## 三、字段设计原因详解

**为什么用 `scenes` 而非 `chapters` 作为主体？**
剧本的基本单位是场景而非章节。一个小说章节可能拆成多个场景，多个章节也可能合并。用 `chapter_ref` 反向关联原文，既尊重剧本结构，又保留与原著的对照能力。

**为什么 `heading` 拆成 location_type / location / time 三字段？**
标准剧本场景标题形如 `INT. 咖啡馆 - DAY`。拆成结构化字段而非单一字符串，便于程序统计场景分布、按场地聚类拍摄、自动排版成行业格式，避免自由文本解析的不确定性。

**为什么 `elements` 用有序数组并带 `type` 区分？**
场景内动作与对白严格按时间顺序交错发生，顺序即语义，必须用数组保序。用 `type` 标签区分元素类型（多态设计），让渲染层能分色显示、让校验器能按类型校验必填字段，扩展新类型（如音效 `sound`）时也无需改动整体结构。

**为什么对白单列 `emotion`／`parenthetical`？**
剧本中括号提示（演员表演指示）是独立要素。单列出来既符合惯例，也方便 AI 在改编时补充潜台词，作者可单独编辑而不动台词本身。

**为什么人物用 `id` 引用而非直接写名字？**
剧本中的结构化引用字段使用人物 id，例如 `scenes[].characters_present` 和对白、括号提示元素里的 `character`。预览时再根据 Story Bible 将 id 显示为当前人物姓名，这样可以让出场人物和对白归属保持稳定，也方便同一人物多个称谓的归一。

需要注意的是，`characters[].name` 以及 `synopsis`、动作描述、对白内容等自然语言文本仍可能直接包含人物姓名。人物改名时，系统会通过引用扫描和批量替换辅助保持这些自由文本的一致性，而不是完全依赖 id 自动覆盖所有文本。

**为什么保留 `logline`／`synopsis` 等概要字段？**
这些是给作者的「导航信息」，便于快速浏览全局和单场景，无需通读全部对白即可定位要修改的部分，降低打磨成本。

---

## 四、字段完整说明

| 路径 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | 是 | 剧本标题 |
| `logline` | string | 是 | 一句话梗概 |
| `source.novel_title` | string | 是 | 原著名 |
| `source.total_chapters` | int | 是 | 原著总章数 |
| `characters[].id` | string | 是 | 人物唯一标识，场景内以此引用 |
| `characters[].name` | string | 是 | 姓名 |
| `characters[].role` | enum | 是 | protagonist / antagonist / supporting / minor |
| `characters[].description` | string | 是 | 人物描述 |
| `characters[].traits` | string[] | 是 | 性格特征标签 |
| `scenes[].id` | string | 是 | 场景标识，如 scene_001 |
| `scenes[].chapter_ref` | int | 是 | 来源章节号 |
| `scenes[].heading.location_type` | enum | 是 | INT / EXT |
| `scenes[].heading.location` | string | 是 | 地点名 |
| `scenes[].heading.time` | enum | 是 | DAY / NIGHT / DAWN / DUSK / CONTINUOUS |
| `scenes[].synopsis` | string | 是 | 场景概要 |
| `scenes[].characters_present` | string[] | 是 | 出场人物 id |
| `scenes[].elements[].type` | enum | 是 | action / dialogue / transition / parenthetical |
| `scenes[].elements[].description` | string | 否 | action / parenthetical 的文字 |
| `scenes[].elements[].character` | string | 否 | dialogue / parenthetical 的人物 id |
| `scenes[].elements[].line` | string | 否 | dialogue 台词 |
| `scenes[].elements[].emotion` | string | 否 | dialogue 情绪/潜台词 |
| `scenes[].elements[].transition` | enum | 否 | CUT TO / FADE OUT / DISSOLVE TO |

---

## 五、完整示例

```yaml
title: 长夜将尽
logline: 一名失忆侦探在追查旧案时,发现自己正是凶手。
source:
  novel_title: 雾城旧事
  total_chapters: 5

characters:
  - id: char_1
    name: 林深
    role: protagonist
    description: 失忆的私家侦探,逻辑缜密但被噩梦困扰。
    traits: [谨慎, 自我怀疑]
  - id: char_2
    name: 苏晚
    role: supporting
    description: 林深的旧识,知晓部分真相。
    traits: [神秘, 忠诚]

scenes:
  - id: scene_001
    chapter_ref: 1
    heading:
      location_type: INT
      location: 废弃事务所
      time: NIGHT
    synopsis: 林深深夜重返旧事务所,发现一封写给自己的信。
    characters_present: [char_1]
    elements:
      - type: action
        description: 雨水顺着破窗渗入。林深推门,灰尘在手电光束中翻飞。
      - type: dialogue
        character: char_1
        line: 这地方……我应该来过。
        emotion: 困惑而警觉
      - type: action
        description: 桌上一封信,收信人正是他自己的名字。
      - type: transition
        transition: CUT TO
```
