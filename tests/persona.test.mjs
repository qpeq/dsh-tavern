import assert from 'node:assert/strict'
import test from 'node:test'

import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { createPlayCardSnapshots } from '../tavern-plugin/lib/domain/play-card-snapshots.js'
import { applyTavernSettingsPatch, presentTavernSettings, findPersona } from '../tavern-plugin/lib/domain/tavern-settings.js'

const card = { name: '艾琳', description: '{{char}} 是旅店老板，认识 {{user}}。', personality: '爽朗', scenario: '雨夜的旅店' }
const persona = { id: 'p1', name: '凯', description: '{{user}} 是流浪剑士，左臂有伤。' }
const planner = createContextPlanner({ prompt: name => name })

test('persona library: save, default, edit and delete', () => {
  let doc = applyTavernSettingsPatch({}, { savePersona: { name: ' 凯 ', description: '剑士' } })
  const id = doc.personas[0].id
  assert.equal(doc.personas[0].name, '凯')
  doc = applyTavernSettingsPatch(doc, { defaultPersonaId: id })
  doc = applyTavernSettingsPatch(doc, { savePersona: { id, name: '凯', description: '流浪剑士' } })
  const shown = presentTavernSettings(doc, {})
  assert.deepEqual(shown.personas, [{ id, name: '凯', description: '流浪剑士' }])
  assert.equal(shown.defaultPersonaId, id)
  assert.equal(findPersona(doc, id).description, '流浪剑士')
  assert.throws(() => applyTavernSettingsPatch(doc, { savePersona: { name: '' } }), /name is required/)
  assert.throws(() => applyTavernSettingsPatch(doc, { defaultPersonaId: 'missing' }), /Default persona not found/)
  doc = applyTavernSettingsPatch(doc, { deletePersona: id })
  assert.deepEqual(presentTavernSettings(doc, {}).personas, [])
  assert.equal(presentTavernSettings(doc, {}).defaultPersonaId, '')
})

test('the persona section is injected right before the character description', async () => {
  const chat = { mode: 'story', persona, macroState: { userName: '凯', local: {}, global: {} } }
  const result = await planner.plan({ purpose: 'play-card-snapshot', card, chat, worldBookContext: '' })
  const kinds = result.sections.map(section => section.kind + ':' + section.text.split(/[:\n]/)[0])
  const personaIndex = result.sections.findIndex(section => section.kind === 'persona')
  assert.ok(personaIndex > 0, kinds.join(' | '))
  assert.ok(result.sections[personaIndex + 1].text.startsWith('设定: '), kinds.join(' | '))
  assert.equal(result.sections[personaIndex].text, 'Player persona (凯): 凯 是流浪剑士，左臂有伤。')
  assert.ok(result.text.indexOf('Player persona') < result.text.indexOf('设定: 艾琳 是旅店老板'))
})

test('no persona, or an empty description, adds nothing', async () => {
  for (const value of [undefined, null, { id: 'p2', name: '凯', description: '  ' }]) {
    const result = await planner.plan({ purpose: 'play-card-snapshot', card, chat: { mode: 'story', persona: value }, worldBookContext: '' })
    assert.equal(result.sections.some(section => section.kind === 'persona'), false)
  }
})

test('the body frame, which omits the description, also omits the persona', async () => {
  const result = await planner.plan({ purpose: 'body', card, chat: { mode: 'story', persona }, worldBookContext: '' })
  assert.equal(result.sections.some(section => section.kind === 'persona'), false)
})

test('switching persona mid-game rebuilds the prefix from the frozen card and renames {{user}}', async () => {
  let liveReads = 0
  const snapshots = createPlayCardSnapshots({
    worldBooks: { bound: async () => null }, planner,
    readCard: async () => { liveReads++; return { ...card, description: '已修改但未确认的卡' } },
    writeChat: async () => {}, logger: { warn() {} }
  })
  const chat = { id: 'c', mode: 'story', messages: [{ text: '既有剧情' }], cardDefinitionSnapshot: card, cardContextSnapshot: '旧前缀',
    cardContextSnapshotVersion: 7, cardContextRevision: 3, macroState: { userName: '你', local: { hp: 3 }, global: {} } }
  const patch = await snapshots.personaReplacement(chat, persona)
  assert.equal(liveReads, 0)
  assert.equal(patch.cardContextRevision, 4)
  assert.deepEqual(patch.persona, persona)
  assert.deepEqual(patch.macroState, { userName: '凯', local: { hp: 3 }, global: {} })
  assert.match(patch.cardContextSnapshot, /Player persona \(凯\): 凯 是流浪剑士，左臂有伤。\n\n设定: 艾琳 是旅店老板，认识 凯。/)
  const cleared = await snapshots.personaReplacement({ ...chat, ...patch }, null)
  assert.equal(cleared.persona, null)
  assert.equal(cleared.macroState.userName, '凯')
  assert.doesNotMatch(cleared.cardContextSnapshot, /Player persona/)
  await assert.rejects(snapshots.personaReplacement({ ...chat, mode: 'card' }, persona), /only apply to play sessions/)
})

test('portraits: validated, keyed by existing personas, pruned on delete', async () => {
  const { createPersonaPortraits } = await import('../tavern-plugin/lib/domain/persona-portraits.js')
  let stored
  const store = createPersonaPortraits({
    async readJson() { return stored },
    async updateJson(_path, updater) { const next = await updater(stored); if (next !== undefined) stored = next; return stored }
  })
  const personas = [{ id: 'a', name: '維' }, { id: 'b', name: '維' }]
  const png = 'data:image/png;base64,iVBORw0KGgo='
  assert.deepEqual(await store.set('a', png, personas), { a: png })
  await assert.rejects(store.set('missing', png, personas), /Persona not found/)
  await assert.rejects(store.set('a', 'data:text/html;base64,PGI+', personas), /PNG, JPEG, WebP or GIF/)
  await assert.rejects(store.set('a', 'data:image/png;base64,' + 'A'.repeat(2 * 1024 * 1024), personas), /too large/)
  await store.set('b', png, personas)
  await store.prune([personas[1]])
  assert.deepEqual(stored, { b: png })
  assert.deepEqual(await store.set('b', null, [personas[1]]), {})
})
