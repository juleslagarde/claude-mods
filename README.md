# claude-mods

Mods for [Claude Code](https://claude.com/claude-code).

## message-queue

Keeps messages in a to-do style queue and lets you choose when each one is sent to Claude. Nothing in the queue reaches Claude until you send it.

```
▸ 1: fix the flaky login test
  2: then update the changelog
  3: bump the version to 1.4

s: send  e: edit  d: delete  k: up  j: down  a: send all  n: queue the draft
```

Adding a message:

- `/queue <message>` adds it, also while Claude is working.
- `ctrl+x enter` queues what is in the prompt box instead of sending it.
- `n` in the pane queues what is in the prompt box.

`/queue` alone opens the pane, and closes it when it is open; a line above the prompt shows how many messages wait and the next one, and clicking it opens or closes the pane. In the pane, a digit selects a message and a letter acts on it: send it, edit it, delete it, or move it up or down. Edit puts the message's text in the prompt box; Enter there saves the new text back to the same place in the queue without sending it, and `c` in the pane cancels the edit. Send all sends every message in order, each as its own turn. A message sent while Claude is working goes in when the current turn ends.

The queue is kept per project folder and survives a restart. Two sessions open in the same folder share the saved list, the last one to change it winning.

### Settings

| Setting | Default | Meaning |
|---|---|---|
| Auto-send | off | When Claude finishes answering, the next queued message is sent by itself; an interrupted turn sends nothing |
| Queue on ctrl+x enter | on | ctrl+x enter queues the draft instead of sending it |
| Show count above the prompt | on | The line above the prompt while the queue is not empty |

### Install

```
/plugin install message-queue --marketplace juleslagarde/claude-mods
```

## usage-status

Shows your Claude subscription usage in a right-aligned band above the prompt: the 5-hour and weekly windows as 10-cell progress bars with the percentage as the cursor, when each window resets, and how fast each window has been filling on average since the session started (points per hour, account-wide). It reads the figures Claude Code already receives with each response, so it makes no extra requests. Bars are green, turning orange from 75% and red from 90%; ◆ marks that average rate, shown once the session has 15 minutes of readings. Its colour compares it with the optimal pace, the steady rate that would use exactly what is left by the window's reset: green below it, orange from it, red from twice it, violet from three times it.

```
5h ▕██23%░░░░░░░░▏ ◆ +6.2/h ⟳ 14:30  │  week ▕████41%░░░░░░▏ ◆ +0.8/h ⟳ mon 09:00
```

The rate is computed from the readings this session receives, so it covers all your usage on the account, whatever session or app it comes from. Nothing is shown on an API-key account.

### Settings

Set in the `/plugin` menu, on the mod's config screen; a change applies at once.

| Setting | Default | Meaning |
|---|---|---|
| Bar colours | `0:success, 75:warning, 90:error` | Stops as percent-used:colour |
| Hourly rate colours | `0:green, 100:orange, 200:red, 300:violet` | Stops as percent-of-optimal-pace:colour |
| Blend between stops | off | Mix neighbouring colours instead of switching at each stop |
| Bar width | `10` | Cells per bar, 4 to 40 |
| Bar characters | `█░` | Also `■□`, `●○`, `▰▱`, `*.` |
| Rate delay | `15` | Minutes of readings before the rate shows |

A stop's colour applies from its threshold up to the next one. Colours can be theme keys (`success`, `warning`, `error`, `claude`, `permission`, `suggestion`…), which follow the light or dark theme, names (`green`, `orange`, `red`, `violet`, `pink`, `cyan`…) or hex (`#ff8800`). Blending works between names and hex colours, not theme keys: the default bar colours are theme keys, so blending only changes the bars once they are set to names or hex, e.g. `0:green, 75:orange, 90:red`. A list that cannot be read falls back to its default.

### Install

At the prompt of a terminal session:

```
/plugin install usage-status --marketplace juleslagarde/claude-mods
```

From a shell:

```
claude plugin install usage-status --marketplace juleslagarde/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `juleslagarde/claude-mods`, then Add plugin.
