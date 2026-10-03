import { compactionPolicy } from './auto-compaction.js'
import { normalizeBackgroundModel } from './background-model-selection.js'
import { randomUUID } from 'node:crypto'

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function promptOverride(document, name) {
  const value = object(document.promptOverrides)[name]
  return typeof value === 'string' && (value.trim() !== '' || name === 'system-append') ? value : null
}

export function normalizeBackgroundTasks(value) {
  const tasks = object(value)
  return { posture: tasks.posture !== false, characterDesign: false, variables: tasks.variables !== false, ledger: false }
}

const PERSONA_LIMIT = 100
const PERSONA_DESCRIPTION_LIMIT = 20000

/** A player persona: who {{user}} is. Its description is injected right before the card description. */
export function normalizePersona(value) {
  const input = object(value)
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : ''
  if (id === '' || name === '') return null
  return { id, name, description: typeof input.description === 'string' ? input.description.trim().slice(0, PERSONA_DESCRIPTION_LIMIT) : '' }
}

export function normalizePersonas(value) {
  const seen = new Set()
  return (Array.isArray(value) ? value : []).map(normalizePersona).filter(persona => persona !== null && !seen.has(persona.id) && seen.add(persona.id)).slice(0, PERSONA_LIMIT)
}

export function defaultPersonaId(document) {
  const id = object(document).defaultPersonaId
  return typeof id === 'string' && normalizePersonas(object(document).personas).some(persona => persona.id === id) ? id : ''
}

export function findPersona(document, id) {
  return typeof id === 'string' && id !== '' ? normalizePersonas(object(document).personas).find(persona => persona.id === id) || null : null
}

function applyPersonaPatch(next, input) {
  let personas = normalizePersonas(next.personas)
  if (Object.hasOwn(input, 'savePersona')) {
    const patch = object(input.savePersona)
    if (typeof patch.name !== 'string' || patch.name.trim() === '' || patch.name.trim().length > 80) throw new Error('Persona name is required (max 80 characters)')
    if (Object.hasOwn(patch, 'description') && (typeof patch.description !== 'string' || patch.description.length > PERSONA_DESCRIPTION_LIMIT)) throw new Error('Persona description is limited to ' + PERSONA_DESCRIPTION_LIMIT + ' characters')
    const id = typeof patch.id === 'string' && patch.id !== '' ? patch.id : randomUUID()
    const persona = normalizePersona({ ...patch, id })
    const index = personas.findIndex(item => item.id === id)
    if (index >= 0) personas[index] = persona
    else if (patch.id) throw new Error('Persona not found; refresh and try again')
    else if (personas.length >= PERSONA_LIMIT) throw new Error('At most ' + PERSONA_LIMIT + ' personas')
    else personas.push(persona)
  }
  if (Object.hasOwn(input, 'deletePersona')) personas = personas.filter(persona => persona.id !== input.deletePersona)
  next.personas = personas
  if (Object.hasOwn(input, 'defaultPersonaId')) {
    if (input.defaultPersonaId !== '' && !personas.some(persona => persona.id === input.defaultPersonaId)) throw new Error('Default persona not found')
    next.defaultPersonaId = input.defaultPersonaId
  }
  if (!personas.some(persona => persona.id === next.defaultPersonaId)) delete next.defaultPersonaId
  if (personas.length === 0) delete next.personas
}

export function normalizePlayDefaults(value) {
  const input = object(value)
  return { playerName: typeof input.playerName === 'string' ? input.playerName.trim().slice(0, 80) || '你' : '你',
    statusBarPlacement: input.statusBarPlacement === 'body' ? 'body' : 'sidebar',
    backgroundTasks: normalizeBackgroundTasks(input.backgroundTasks),
    webSearchEnabled: input.webSearchEnabled === true, sceneImagesEnabled: input.sceneImagesEnabled === true }
}

export function applyTavernSettingsPatch(current, patch) {
  const next = Object.assign({}, object(current))
  const input = object(patch)
  if (['savePersona', 'deletePersona', 'defaultPersonaId'].some(key => Object.hasOwn(input, key))) applyPersonaPatch(next, input)
  if (Object.hasOwn(input, 'defaultPlaySettings')) {
    const patch = object(input.defaultPlaySettings)
    for (const key of ['webSearchEnabled', 'sceneImagesEnabled']) if (Object.hasOwn(patch, key) && typeof patch[key] !== 'boolean') throw new Error('默认开关必须为布尔值')
    if (Object.hasOwn(patch, 'playerName') && (typeof patch.playerName !== 'string' || patch.playerName.length > 80)) throw new Error('玩家称呼最多 80 字')
    if (Object.hasOwn(patch, 'statusBarPlacement') && !['body', 'sidebar'].includes(patch.statusBarPlacement)) throw new Error('状态栏位置无效')
    for (const key of ['variables', 'posture']) if (Object.hasOwn(object(patch.backgroundTasks), key) && typeof patch.backgroundTasks[key] !== 'boolean') throw new Error('默认结算开关必须为布尔值')
    const current = normalizePlayDefaults(next.defaultPlaySettings)
    next.defaultPlaySettings = normalizePlayDefaults({ ...current, ...patch, backgroundTasks: { ...current.backgroundTasks, ...object(patch.backgroundTasks) } })
  }
  if (Object.hasOwn(input, 'defaultWritingSkill')) {
    const { name, enabled } = object(input.defaultWritingSkill)
    if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || typeof enabled !== 'boolean') throw new Error('无效的写作 Skill 配置')
    const disabled = Array.isArray(next.defaultDisabledWritingSkills) ? next.defaultDisabledWritingSkills : []
    next.defaultDisabledWritingSkills = enabled ? disabled.filter(value => value !== name) : [...new Set([...disabled, name])]
  }
  for (const name of ['defaultForegroundModel', 'defaultBackgroundModel', 'defaultWorkbenchModel']) {
    if (!Object.hasOwn(input, name)) continue
    const selection = normalizeBackgroundModel(input[name])
    if (input[name] !== null && !selection) throw new Error('默认模型配置无效')
    next[name] = selection
  }
  if (Object.hasOwn(input, 'hideContextAndReasoning')) {
    if (typeof input.hideContextAndReasoning !== 'boolean') throw new Error('无效的对话显示设置')
    next.hideContextAndReasoning = input.hideContextAndReasoning
  }
  if (Object.hasOwn(input, 'candidateDismissMode')) {
    if (!['after-fill', 'after-send'].includes(input.candidateDismissMode)) throw new Error('无效的候选项收起方式')
    next.candidateDismissMode = input.candidateDismissMode
  }
  if (Object.hasOwn(input, 'contextCompaction')) next.contextCompaction = { ...compactionPolicy(input.contextCompaction), revision: Date.now() }
  if (Object.prototype.hasOwnProperty.call(input, 'backgroundTasks')) {
    next.backgroundTasks = normalizeBackgroundTasks({ ...normalizeBackgroundTasks(next.backgroundTasks), ...object(input.backgroundTasks) })
  }
  if (input.sillyModeEnabled === true || input.compatibilityMode === true) throw new Error('silly 模式已停用')
  if (Object.prototype.hasOwnProperty.call(input, 'sillyModeEnabled')) next.sillyModeEnabled = false
  if (Object.prototype.hasOwnProperty.call(input, 'compatibilityMode')) next.compatibilityMode = input.compatibilityMode === true
  if (Object.hasOwn(input, 'systemAppendEnabled')) next.systemAppendEnabled = input.systemAppendEnabled === true
  if (Object.prototype.hasOwnProperty.call(input, 'webSearchEnabled')) next.webSearchEnabled = input.webSearchEnabled === true
  if (Object.prototype.hasOwnProperty.call(input, 'backgroundModel')) {
    next.backgroundModelRevision = (Number.isSafeInteger(next.backgroundModelRevision) ? next.backgroundModelRevision : 0) + 1
    if (input.backgroundModel === null) delete next.backgroundModel
    else {
      const backgroundModel = normalizeBackgroundModel(input.backgroundModel)
      if (backgroundModel === null) throw new Error('后台模型配置无效')
      next.backgroundModel = backgroundModel
    }
  }
  const legacyStory = Object.prototype.hasOwnProperty.call(input, 'storyPrompt') ? { name: 'story', text: input.storyPrompt } : null
  const promptChange = Object.prototype.hasOwnProperty.call(input, 'systemPrompt') ? object(input.systemPrompt) : legacyStory
  if (promptChange !== null) {
    const name = typeof promptChange.name === 'string' ? promptChange.name : ''
    if (name === '') throw new Error('系统提示词名称不能为空')
    const overrides = Object.assign({}, object(next.promptOverrides))
    if (promptChange.text === null) {
      delete overrides[name]
    } else {
      if (typeof promptChange.text !== 'string' || (promptChange.text.trim() === '' && name !== 'system-append')) throw new Error('系统提示词不能为空')
      if (promptChange.text.length > 100000) throw new Error('系统提示词不能超过 100000 字符')
      overrides[name] = promptChange.text.trim()
    }
    if (Object.keys(overrides).length === 0) delete next.promptOverrides
    else next.promptOverrides = overrides
  }
  if (Object.prototype.hasOwnProperty.call(input, 'systemPrompts')) {
    const values = object(input.systemPrompts)
    const overrides = Object.assign({}, object(next.promptOverrides))
    for (const [name, value] of Object.entries(values)) {
      if (typeof value !== 'string' || (value.trim() === '' && name !== 'system-append' && name !== 'card-system')) throw new Error('系统提示词不能为空: ' + name)
      if (value.length > 100000) throw new Error('系统提示词不能超过 100000 字符: ' + name)
      overrides[name] = value.trim()
    }
    if (Object.keys(overrides).length === 0) delete next.promptOverrides
    else next.promptOverrides = overrides
  }
  if (Array.isArray(input.resetSystemPrompts)) {
    const overrides = Object.assign({}, object(next.promptOverrides))
    for (const name of input.resetSystemPrompts) delete overrides[name]
    if (Object.keys(overrides).length === 0) delete next.promptOverrides
    else next.promptOverrides = overrides
  } else if (input.resetSystemPrompts === true) delete next.promptOverrides
  return next
}

export function presentTavernSettings(document, defaults) {
  const prompts = Object.keys(object(defaults)).map(function (name) {
    const custom = promptOverride(object(document), name)
    return { name, text: custom === null ? String(defaults[name] || '') : custom, customized: custom !== null }
  })
  const story = prompts.find(function (item) { return item.name === 'story' }) || { text: '', customized: false }
  return {
    defaultPlaySettings: normalizePlayDefaults(object(document).defaultPlaySettings),
    personas: normalizePersonas(object(document).personas),
    defaultPersonaId: defaultPersonaId(document),
    defaultDisabledWritingSkills: Array.isArray(object(document).defaultDisabledWritingSkills) ? object(document).defaultDisabledWritingSkills.filter(name => typeof name === 'string') : [],
    defaultForegroundModel: normalizeBackgroundModel(object(document).defaultForegroundModel),
    defaultBackgroundModel: normalizeBackgroundModel(object(document).defaultBackgroundModel),
    defaultWorkbenchModel: normalizeBackgroundModel(object(document).defaultWorkbenchModel),
    contextCompaction: compactionPolicy(object(document).contextCompaction),
    // Fork: indicators (context injection, system prompt, thinking, turn usage/time, command rows) are hidden unless shown.
    hideContextAndReasoning: object(document).hideContextAndReasoning !== false,
    candidateDismissMode: object(document).candidateDismissMode === 'after-send' ? 'after-send' : 'after-fill',
    compatibilityMode: false,
    sillyModeEnabled: false,
    webSearchEnabled: object(document).webSearchEnabled === true,
    systemAppendEnabled: object(document).systemAppendEnabled !== false,
    backgroundModel: normalizeBackgroundModel(object(document).backgroundModel),
    backgroundTasks: normalizeBackgroundTasks(object(document).backgroundTasks),
    // Card rendering uses a fixed trusted policy; legacy preferences are no longer applied.
    trustedCardMode: true,
    systemPrompts: prompts,
    storyPrompt: story.text,
    storyPromptCustomized: story.customized
  }
}

export function resolveSystemPrompt(document, name, fallback) {
  const custom = promptOverride(object(document), name)
  if (custom !== null) return custom
  return fallback(name)
}
