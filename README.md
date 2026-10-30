# claude-mods

Mods for [Claude Code](https://claude.com/claude-code).

## usage-status

Shows your Claude subscription usage in a right-aligned band above the prompt: the 5-hour and weekly windows as 10-cell progress bars with the percentage as the cursor, when each window resets, and how many points this session has used since it started. It reads the figures Claude Code already receives with each response, so it makes no extra requests. Bars turn orange from 75% and red from 90%.

```
5h (**23%........) session +4.0 ↻14:30 · week (****41%......) session +1.5 ↻mon 09:00
```

The session figure is the account total's increase since the session's first response, so other sessions running at the same time are counted in it. Nothing is shown on an API-key account.

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
