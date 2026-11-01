import { expect, test } from 'claude-code/testing'

const ROOT = '/proj'
const KEY = `project:${ROOT}`
const TOOL = 'mcp__arch-map__update_architecture'

const PANE = {
  plugin: 'arch-map',
  component: 'Pane',
  requestId: 'arch-map',
  props: {
    title: 'Architecture',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const V1 = {
  title: 'Todo app',
  summary: 'A web app that saves todos through an API into Postgres.',
  nodes: [
    { id: 'u', label: 'You', kind: 'user' },
    { id: 'web', label: 'Web app', kind: 'client' },
    { id: 'api', label: 'API server', kind: 'server' },
    { id: 'db', label: 'Postgres', kind: 'database' },
  ],
  edges: [
    { from: 'u', to: 'web', label: 'clicks Add' },
    { from: 'web', to: 'api', label: 'POST /todos' },
    { from: 'api', to: 'db', label: 'SQL insert' },
  ],
  flow: ['You click Add', 'Web app sends POST /todos', 'API inserts a row'],
  lesson: { concept: 'Layering', explanation: 'Each layer talks only to the next.' },
}

// v2: adds a cache, drops the user node, relabels the API.
const V2 = {
  ...V1,
  why: 'Added Redis because the list page hit Postgres on every load.',
  nodes: [
    { id: 'web', label: 'Web app', kind: 'client' },
    { id: 'api', label: 'API (stateless)', kind: 'server' },
    { id: 'cache', label: 'Redis', kind: 'cache' },
    { id: 'db', label: 'Postgres', kind: 'database' },
  ],
  edges: [
    { from: 'web', to: 'api', label: 'POST /todos' },
    { from: 'api', to: 'cache', label: 'GET list' },
    { from: 'api', to: 'db', label: 'SQL insert' },
  ],
  lesson: { concept: 'Caching', explanation: 'Keep hot reads close.' },
}

function engine(on: any, store: Record<string, unknown> = {}) {
  on('store.get', (_: unknown, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: unknown, e: any) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.root', () => ({ value: ROOT }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => undefined)
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
}

const start = ($: any) => $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

test('empty pane explains itself', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /No diagram yet/ }))?.text).toBe('No diagram yet')
  await ui.unmount()
})

test('versions are kept, diffed and stepped through', async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, ...V1 } as any)
  const ran = await $.tool.call({ tool: TOOL, ...V2 } as any)
  expect(String((ran as any).result)).toContain('v2')
  expect(String((ran as any).result)).toContain('1 added, 1 changed, 1 removed')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^\+ Redis$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^~ API \(stateless\)$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /− You \(person\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Added Redis because/ })).toBeDefined()

    await ui.press({ key: 'prev' })
    expect(await ui.find({ type: 'Text', text: /^v1$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Redis$|Redis/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Concept: Layering/ })).toBeDefined()

    await ui.press({ key: 'latest' })
    expect(await ui.find({ type: 'Text', text: /^v2$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('history is saved per project and loaded next session', async ($, on) => {
  const saved = {
    [KEY]: { enabled: true, history: [{ ...V1, version: 7 }] },
    'project:/other': { enabled: true, history: [{ ...V2, title: 'Other', version: 1 }] },
  }
  const store: Record<string, unknown> = saved
  engine(on, store)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^v7$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Todo app/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: TOOL, ...V2 } as any)
  const rec = store[KEY] as any
  expect(rec.history.length).toBe(2)
  expect(rec.history[1].version).toBe(8)
})

test('/arch-off turns it off for this project only', async ($, on) => {
  const store: Record<string, unknown> = {}
  engine(on, store)
  await start($)
  const off = await $.command.run({ command: 'arch-off' } as any)
  expect(String((off as any).text)).toContain('off for this project')
  expect((store[KEY] as any).enabled).toBe(false)

  const refused = await $.tool.call({ tool: TOOL, ...V1 } as any)
  expect((refused as any).isError).toBe(true)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /is off for this project/ })).toBeDefined()
  await ui.unmount()

  await $.command.run({ command: 'arch-on' } as any)
  expect((store[KEY] as any).enabled).toBe(true)
  const ok = await $.tool.call({ tool: TOOL, ...V1 } as any)
  expect((ok as any).isError).toBeUndefined()
})

test('a bad edge is refused', async ($, on) => {
  engine(on)
  await start($)
  const ran = await $.tool.call({
    tool: TOOL,
    title: 'x',
    nodes: [{ id: 'a', label: 'A', kind: 'server' }],
    edges: [{ from: 'a', to: 'zzz' }],
  } as any)
  expect((ran as any).isError).toBe(true)
})

test('clicking a part explains it once, then from cache', async ($, on) => {
  engine(on)
  let calls = 0
  let asked = ''
  on('model.complete', (_: unknown, e: any) => {
    calls++
    asked = String(e.prompt)
    return { value: { isAnswered: true, text: "Why it's here: it stores the todos.", usage: {} } }
  })
  await start($)
  await $.tool.call({ tool: TOOL, ...V1 } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'node:db' })
    expect(await ui.find({ type: 'Text', text: /it stores the todos/ })).toBeDefined()
    await ui.press({ key: 'close-explain' })
    expect(await ui.find({ type: 'Text', text: /it stores the todos/ })).toBeUndefined()
    await ui.unmount()
  }
  expect(calls).toBe(1)
  expect(asked).toContain('Clicked: Postgres [database]')
  expect(asked).toContain('api -> db (SQL insert)')
})
