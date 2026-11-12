import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'message-queue',
  component: 'Pane',
  requestId: 'message-queue',
  props: {
    title: 'Queue',
    isFocused: true,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const composer = { kind: 'composer' } as const
const typed = { origin: composer, presentation: { isFullscreen: true, columns: 120 } }

test('queued messages are listed, and send submits the selected one', async ($, on) => {
  mock.store(on)
  const sent: string[] = []
  on('command.register', () => ({ value: { command: 'queue' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'queue', args: 'first thing', ...typed })
  await $.command.run({ command: 'queue', args: 'second thing', ...typed })

  // ctrl+x enter: queued, not sent.
  const waited = await $.prompt.submit({ text: 'third thing', wait: true, origin: composer })
  expect(waited.drop).toBeDefined()
  // A plain Enter goes through.
  await $.prompt.submit({ text: 'plain', wait: false, origin: composer })
  expect(sent).toEqual(['plain'])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /first thing/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /third thing/ })).toBeDefined()

  // The first is selected until another is picked.
  await ui.press({ key: 'send' })
  expect(sent).toEqual(['plain', 'first thing'])
  expect(await ui.find({ type: 'Text', text: /first thing/ })).toBeUndefined()

  await ui.press({ key: 'delete' })
  expect(await ui.find({ type: 'Text', text: /second thing/ })).toBeUndefined()

  await ui.press({ key: 'all' })
  expect(sent).toEqual(['plain', 'first thing', 'third thing'])
  expect((await ui.find({ type: 'Text', text: /Nothing queued/ }))).toBeDefined()
  await ui.unmount()
})

test('auto-send, when on, sends the next message as a turn ends in an answer', { options: { autoSend: true } }, async ($, on) => {
  mock.store(on)
  const sent: string[] = []
  let arrived = () => {}
  const firstSent = new Promise<void>(resolve => { arrived = resolve })
  on('command.register', () => ({ value: { command: 'queue' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: 'done' }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    arrived()
    return { text: e.text }
  })

  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'queue', args: 'one', ...typed })
  await $.command.run({ command: 'queue', args: 'two', ...typed })

  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  expect(sent).toEqual([])
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  await firstSent
  expect(sent).toEqual(['one'])
})

test('auto-send is off by default', async ($, on) => {
  mock.store(on)
  const sent: string[] = []
  on('command.register', () => ({ value: { command: 'queue' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: 'done' }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'queue', args: 'one', ...typed })
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  // A few round trips through the engine give a stray send time to land.
  for (const more of ['two', 'three', 'four']) await $.command.run({ command: 'queue', args: more, ...typed })
  expect(sent).toEqual([])
})

test('edit puts the text in the box and Enter saves it back in place, unsent', async ($, on) => {
  mock.store(on)
  const sent: string[] = []
  let box = ''
  on('command.register', () => ({ value: { command: 'queue' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.fill', (_, e) => {
    box = e.text
    return { isFilled: true, text: box, cursor: box.length }
  })
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'queue', args: 'one', ...typed })
  await $.command.run({ command: 'queue', args: 'two', ...typed })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'edit' })
  expect(box).toBe('one')

  const saved = await $.prompt.submit({ text: 'one, edited', wait: false, origin: composer })
  expect(saved.drop).toBeDefined()
  expect(sent).toEqual([])
  expect(await ui.find({ type: 'Text', text: /one, edited/ })).toBeDefined()

  // Saved in place: it is still the first, so send takes it.
  await ui.press({ key: 'send' })
  expect(sent).toEqual(['one, edited'])
  await ui.unmount()
})
