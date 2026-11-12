import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Item } from '../types'

const PANE = 'message-queue'
const TITLE = 'Queue'

const itemsAtom = atom({ plugin: 'message-queue', key: 'items' } as const, [], { shape: 'items-1' })
const selectedAtom = atom({ plugin: 'message-queue', key: 'selected' } as const, '')
const editingAtom = atom({ plugin: 'message-queue', key: 'editing' } as const, '')

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** One line of at most `width` cells standing for a message. */
export const preview = (text: string, width: number) => {
  const line = text.trim().replace(/\s*\n\s*/g, ' ⏎ ')
  const room = Math.max(8, width)
  return line.length > room ? `${line.slice(0, room - 1)}…` : line
}

const isItems = (v: unknown): v is Item[] =>
  Array.isArray(v) && v.every(i => i && typeof i.id === 'string' && typeof i.text === 'string')

// The queue is kept per project folder so it outlives the session.
let storeKey = 'queue:'

const change = async ($: EngineInterface, fn: (list: Item[]) => Item[]) => {
  const list = await update($, itemsAtom, fn)
  await $.store.set(storeKey, list)
  return list
}

const add = ($: EngineInterface, text: string) =>
  change($, list => [...list, { id: newId(), text }])

const openPane = ($: EngineInterface, focus: boolean) =>
  $.ui.open({ id: PANE, title: TITLE, ...(focus ? { focus: true as const } : {}) })

/** The selected item, or the first when the selection is gone. */
const current = async ($: EngineInterface) => {
  const list = await read($, itemsAtom)
  const id = await read($, selectedAtom)
  return list.find(i => i.id === id) ?? list[0]
}

const send = async ($: EngineInterface, item: Item) => {
  await change($, list => list.filter(i => i.id !== item.id))
  const sent = await $.prompt.submit({ text: item.text, asUser: true })
  if (sent.drop !== undefined) {
    await change($, list => [item, ...list])
    $.ui.toast(`Not sent, kept in the queue: ${sent.drop}`)
  }
}

const sendSelected = async ($: EngineInterface) => {
  const item = await current($)
  if (!item) return
  if (item.id === (await read($, editingAtom))) {
    $.ui.toast('That message is being edited: press Enter in the prompt box to save it first')
    return
  }
  await send($, item)
}

const sendAll = async ($: EngineInterface) => {
  const editing = await read($, editingAtom)
  for (const item of await read($, itemsAtom)) if (item.id !== editing) await send($, item)
}

const editSelected = async ($: EngineInterface) => {
  const item = await current($)
  if (!item) return
  if ((await $.prompt.read()).text.trim()) {
    $.ui.toast('The prompt box already holds a draft: send or clear it first')
    return
  }
  // The item stays in the list while its text is in the box: Enter there
  // writes the new text back to it (the `prompt.submit` hook below).
  const { isFilled } = await $.prompt.fill({ text: item.text })
  if (isFilled) await update($, editingAtom, () => item.id)
}

// The engine puts a dropped prompt back in the box; once the drop has landed,
// empty the box again, unless the person has typed something else meanwhile.
const isPaneOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE)

/** Opens the pane, or closes it when it is open; true when it ends up open. */
const togglePane = async ($: EngineInterface) => {
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await openPane($, true)
  return true
}

const clearAfterDrop = ($: EngineInterface, text: string) => {
  $.clock.after(50, async () => {
    if ((await $.prompt.read()).text.trim() === text) await $.prompt.fill({ text: '' })
  })
}

const cancelEdit = async ($: EngineInterface) => {
  const id = await read($, editingAtom)
  const item = (await read($, itemsAtom)).find(i => i.id === id)
  await update($, editingAtom, () => '')
  // Clear the box only while it still holds the text put there.
  if (item && (await $.prompt.read()).text === item.text) await $.prompt.fill({ text: '' })
}

const deleteSelected = async ($: EngineInterface) => {
  const item = await current($)
  if (item) await change($, list => list.filter(i => i.id !== item.id))
}

const move = async ($: EngineInterface, by: -1 | 1) => {
  const item = await current($)
  if (!item) return
  await update($, selectedAtom, () => item.id)
  await change($, list => {
    const from = list.findIndex(i => i.id === item.id)
    const to = from + by
    if (from < 0 || to < 0 || to >= list.length) return list
    const out = [...list]
    out.splice(from, 1)
    out.splice(to, 0, item)
    return out
  })
}

const addDraft = async ($: EngineInterface) => {
  const text = (await $.prompt.read()).text.trim()
  if (!text) {
    $.ui.toast('The prompt box is empty')
    return
  }
  await add($, text)
  await $.prompt.fill({ text: '' })
}

export const register: Register = (on, options) => {
  const captureWait = options.captureWaitSubmit !== false
  const showBand = options.showBand !== false
  const autoSend = options.autoSend === true

  on('session.start', async ($, e, next) => {
    storeKey = `queue:${e.cwd}`
    if ((await read($, itemsAtom)).length === 0) {
      const kept = await $.store.get(storeKey)
      if (isItems(kept) && kept.length) await update($, itemsAtom, () => kept)
    }
    await $.command.register({
      name: 'queue',
      description: 'Queue a message for later, or open the queue',
      argumentHint: '[message]',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'queue' }, async ($, e) => {
    const text = e.args.trim()
    if (!text) {
      // /queue alone toggles the pane.
      if (!(await togglePane($))) return { text: 'Queue closed.' }
      const n = (await read($, itemsAtom)).length
      return { text: n ? `${n} queued.` : 'The queue is empty. Add with /queue <message>.' }
    }
    const list = await add($, text)
    return { text: `Queued (${list.length} waiting).` }
  })

  on('prompt.submit', async ($, e, next) => {
    const isTyped = e.origin.kind === 'composer' && !e.command && !e.isMeta && !e.attachments?.length
    const text = e.text.trim()
    if (!isTyped || !text) return next(e)

    // Enter while editing a queued message saves it back where it was.
    const editing = await read($, editingAtom)
    if (editing) {
      await update($, editingAtom, () => '')
      const list = await read($, itemsAtom)
      if (list.some(i => i.id === editing)) {
        await change($, all => all.map(i => (i.id === editing ? { ...i, text } : i)))
      } else {
        await add($, text)
      }
      clearAfterDrop($, text)
      return { drop: 'Saved back to the queue, not sent.' }
    }

    if (captureWait && e.wait) {
      const list = await add($, text)
      clearAfterDrop($, text)
      return { drop: `Queued instead of sent (${list.length} waiting). /queue opens the list.` }
    }
    return next(e)
  })

  if (autoSend) {
    // Once the main loop has answered, the next message goes in by itself. An
    // interrupted, refused or failed turn sends nothing, so Esc stops the run.
    on('turn.complete', async ($, e, next) => {
      const ran = await next(e)
      if (e.reason === 'answer' && e.agentId === undefined) {
        const editing = await read($, editingAtom)
        const first = (await read($, itemsAtom)).find(i => i.id !== editing)
        if (first) void send($, first)
      }
      return ran
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, itemsAtom)
    const selectedId = await read($, selectedAtom)
    const selected = list.find(i => i.id === selectedId) ?? list[0]
    const editingId = await read($, editingAtom)
    const isEditing = list.some(i => i.id === editingId)
    const width = e.props.bodyColumns - 6

    if (!list.length) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Nothing queued.</Text>
          <Text dimColor>/queue {'<message>'} adds one{captureWait ? '; ctrl+x enter queues the draft' : ''}.</Text>
          <Button key="draft" plain hotkey="n" onPress={() => addDraft($)}>queue the draft</Button>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {list.map((item, i) => {
          const isSelected = item.id === selected?.id
          const mark = item.id === editingId ? '✎ ' : isSelected ? '▸ ' : '  '
          const label = `${mark}${preview(item.text, width)}`
          return i < 9 ? (
            <Button key={`item-${item.id}`} plain hotkey={String(i + 1)} onPress={() => update($, selectedAtom, () => item.id)}>
              <Text bold={isSelected}>{label}</Text>
            </Button>
          ) : (
            <Button key={`item-${item.id}`} plain onPress={() => update($, selectedAtom, () => item.id)}>
              <Text bold={isSelected}>   {label}</Text>
            </Button>
          )
        })}
        <Text dimColor>
          {isEditing
            ? '✎ editing in the prompt box: Enter saves it back here'
            : autoSend
              ? 'auto-send is on: the next goes when Claude finishes'
              : ' '}
        </Text>
        <Box flexWrap="wrap" columnGap={2}>
          <Button key="send" plain hotkey="s" onPress={() => sendSelected($)}>send</Button>
          {isEditing ? (
            <Button key="cancel-edit" plain hotkey="c" onPress={() => cancelEdit($)}>cancel edit</Button>
          ) : (
            <Button key="edit" plain hotkey="e" onPress={() => editSelected($)}>edit</Button>
          )}
          <Button key="delete" plain hotkey="d" onPress={() => deleteSelected($)}>delete</Button>
          <Button key="up" plain hotkey="k" onPress={() => move($, -1)}>up</Button>
          <Button key="down" plain hotkey="j" onPress={() => move($, 1)}>down</Button>
          <Button key="all" plain hotkey="a" onPress={() => sendAll($)}>send all</Button>
          <Button key="draft" plain hotkey="n" onPress={() => addDraft($)}>queue the draft</Button>
        </Box>
      </Box>
    )
  })

  if (showBand) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const list = await read($, itemsAtom)
      if (e.props.hasSurvey || !list.length) return next(e)

      const { Box, Button, Text } = $.ui.resolve(e)
      const head = `☰ ${list.length} queued`
      const room = e.props.bodyColumns - head.length - 12

      return (
        <Box flexDirection="column">
          {await next(e)}
          <Button key="open-queue" plain onPress={() => { void togglePane($) }}>
            <Text color="suggestion">{head}</Text>
            <Text dimColor>{room > 12 ? ` · next: ${preview(list[0]!.text, room)}` : ''}</Text>
          </Button>
        </Box>
      )
    })
  }
}
