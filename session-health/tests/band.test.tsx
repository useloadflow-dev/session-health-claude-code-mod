import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// What a session provides beneath the plugin: a clock, and the engine's own (empty) band.
const engineBand = (on: On) => {
  mock.clock(on)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}

const BAND = {
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
}

test('band draws on terminal and desktop with no measurement yet', async ($, on) => {
  engineBand(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-health', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /CONTEXT/ })).toBeDefined()
    await ui.unmount()
  }
})

test('band yields to a survey', async ($, on) => {
  engineBand(on)
  const ui = await $.ui.mount({
    plugin: 'session-health',
    surface: 'terminal',
    ...BAND,
    props: { ...BAND.props, hasSurvey: true },
  })
  expect(await ui.find({ type: 'Text', text: /CONTEXT/ })).toBe(undefined)
  await ui.unmount()
})
