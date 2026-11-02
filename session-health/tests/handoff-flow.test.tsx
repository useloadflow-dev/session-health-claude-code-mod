import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// [fresh start] hands the writing to project-pickup's `/pickup save`; these hooks stand for it.
declare const setTimeout: (fn: () => void, ms: number) => unknown
const tick = () => new Promise<void>(r => setTimeout(() => r(), 1))
const FRESH = { options: { compactPct: 0, freshCompactions: 0 } }

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} },
}

type Host = { toasts: string[]; saves: string[] }

function host(on: On, opts: { pickup: boolean; answer?: string; run?: () => Promise<string> }): Host {
  const h: Host = { toasts: [], saves: [] }
  mock.clock(on)
  on('session.root', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: 's1' }))
  on('session.turns', () => ({ value: 5 }))
  on('ui.toast', (_$, e) => {
    h.toasts.push(e.text)
    return { value: undefined }
  })
  on('command.list', () => ({ value: (opts.pickup ? [{ name: 'pickup' }] : [{ name: 'compact' }]) as never }))
  on('command.run', { command: 'pickup' }, async (_$, e) => {
    h.saves.push(e.args)
    if (opts.run) return { text: await opts.run() }
    return { text: opts.answer ?? 'Saved hand-off to HANDOFF.md (5/7). Run /clear to start fresh from it.' }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return h
}

test('[fresh start] runs /pickup save and says the hand-off is ready', FRESH, async ($, on) => {
  const h = host(on, { pickup: true })
  const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
  await ui.press({ key: 'fresh' })
  expect(h.saves).toEqual(['save'])
  expect(h.toasts).toContain('Hand-off ready — run /clear')
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /hand-off ready/ })).toBeDefined()
  await ui.unmount()
})

test('without project-pickup, [fresh start] says how to install it', FRESH, async ($, on) => {
  const h = host(on, { pickup: false })
  const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
  await ui.press({ key: 'fresh' })
  expect(h.saves).toEqual([])
  expect(h.toasts[0]).toContain('/plugin install project-pickup@session-health')
  await ui.redraw()
  expect(await ui.find({ key: 'fresh' })).toBeDefined()
  await ui.unmount()
})

test('a save project-pickup could not make leaves the band as it was', FRESH, async ($, on) => {
  const h = host(on, { pickup: true, answer: 'Hand-off not saved: nothing to save yet' })
  const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
  await ui.press({ key: 'fresh' })
  expect(h.toasts).toEqual([])
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /hand-off ready/ })).toBe(undefined)
  expect(await ui.find({ key: 'fresh' })).toBeDefined()
  await ui.unmount()
})

test('two fast [fresh start] presses save once', FRESH, async ($, on) => {
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  const h = host(on, { pickup: true, run: () => gate.then(() => 'Saved hand-off.') })
  const ui = await $.ui.mount({ plugin: 'session-health', surface: 'terminal', ...BAND })
  const a = ui.press({ key: 'fresh' })
  const b = ui.press({ key: 'fresh' })
  for (let i = 0; i < 20; i++) await tick()
  release()
  await Promise.all([a, b])
  expect(h.saves.length).toBe(1)
  await ui.unmount()
})
