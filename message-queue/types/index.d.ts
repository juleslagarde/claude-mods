/** One message waiting in the queue. */
export type Item = { id: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'message-queue': {
      items: Shaped<Item[]>
      /** The id of the item the pane's actions apply to. */
      selected: string
      /** The id of the item whose text is in the prompt box being edited, or ''. */
      editing: string
    }
  }
}
