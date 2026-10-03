import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'
import { applyTavernSettingsPatch, normalizeButtonizeRules } from '../tavern-plugin/lib/domain/tavern-settings.js'

test('fork Buttonize rules: create, update, validate, delete', () => {
  let settings = applyTavernSettingsPatch({}, { saveButtonizeRule: { heading: ' 行動選擇 ' } })
  const [rule] = settings.buttonizeRules
  assert.deepEqual({ ...rule, id: undefined }, { id: undefined, name: '行動選擇', heading: '行動選擇', enabled: true })
  settings = applyTavernSettingsPatch(settings, { saveButtonizeRule: { id: rule.id, heading: '/行動|選項/', name: 'Actions', enabled: false } })
  assert.deepEqual(settings.buttonizeRules.map(item => [item.name, item.heading, item.enabled]), [['Actions', '/行動|選項/', false]])
  assert.throws(() => applyTavernSettingsPatch(settings, { saveButtonizeRule: { heading: '/(/' } }), /invalid regex/)
  assert.throws(() => applyTavernSettingsPatch(settings, { saveButtonizeRule: { heading: '' } }), /heading is required/)
  assert.throws(() => applyTavernSettingsPatch(settings, { saveButtonizeRule: { id: 'missing', heading: 'x' } }), /not found/)
  assert.deepEqual(applyTavernSettingsPatch(settings, { deleteButtonizeRule: rule.id }).buttonizeRules, undefined)
  assert.deepEqual(normalizeButtonizeRules([{ id: 'a', heading: 'x' }, { id: 'a', heading: 'y' }, { heading: 'no id' }]).map(item => item.heading), ['x'])
})

const source = await readFile(new URL('../tavern-plugin/src/client/features/buttonize.js', import.meta.url), 'utf8')
function projection(window) {
  const context = vm.createContext({ window, document: window.document, Element: window.Element, React: {}, rpc: async () => ({}) })
  return vm.runInContext(source + '\n;({ applyButtonize, buttonizeItemText })', context)
}
const reply = (turn, body) => `<div data-chat-flow-kind="assistant-step" data-chat-turn="${turn}"><div class="md">${body}</div></div>`
const choices = '<h3>行動選擇</h3><ol><li>[誘惑] 輕吻她</li><li>[主動] 牽起她的手</li></ol>'

test('fork Buttonize projection: the list after a matching heading, live only in the latest reply', () => {
  const dom = new JSDOM(`<div id="root">${reply(1, choices)}${reply(2, '<h3>場景資訊</h3><ul><li>位置：宿舍</li></ul>' + choices + '<p>後記</p><ol><li>not a choice</li></ol>')}</div>`)
  const { applyButtonize } = projection(dom.window)
  const root = dom.window.document.getElementById('root')
  const state = () => [...root.querySelectorAll('li')].map(li => li.getAttribute('data-dsh-buttonize') + ':' + li.getAttribute('aria-disabled') + ':' + li.getAttribute('tabindex'))
  applyButtonize(root, [{ heading: '行動選擇', enabled: true }], false)
  // turn 1's choices are old; in turn 2 the 場景資訊 list is untouched, the choices are live, and only the
  // first list after the heading counts (the one after 後記 stays plain).
  assert.deepEqual(state(), ['old:true:-1', 'old:true:-1', 'null:null:null', 'live:false:0', 'live:false:0', 'null:null:null'])
  assert.equal(root.querySelectorAll('[data-dsh-buttonize-list]').length, 2)
  applyButtonize(root, [{ heading: '行動選擇', enabled: true }], true)
  assert.deepEqual(state().slice(3, 5), ['live:true:-1', 'live:true:-1'])
  applyButtonize(root, [{ heading: '/場景|資訊/', enabled: true }], false)
  assert.deepEqual(state(), ['null:null:null', 'null:null:null', 'live:false:0', 'null:null:null', 'null:null:null', 'null:null:null'])
  applyButtonize(root, [{ heading: '行動選擇', enabled: false }], false)
  assert.equal(root.querySelectorAll('[data-dsh-buttonize], [data-dsh-buttonize-list], [role=button]').length, 0)
  dom.window.close()
})
