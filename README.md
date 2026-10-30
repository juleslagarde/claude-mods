# claude-mods

Mods for [Claude Code](https://claude.com/claude-code).

## usage-status

Shows your Claude subscription usage in a right-aligned band above the prompt: the 5-hour and weekly windows as 10-cell progress bars with the percentage as the cursor, when each window resets, and how fast each window has been filling on average since the session started (points per hour, account-wide). It reads the figures Claude Code already receives with each response, so it makes no extra requests. Bars are green, turning orange from 75% and red from 90%; ◆ marks that average rate, shown once the session has 15 minutes of readings. It turns orange when it is faster than the steady rate that would use exactly what is left by the window's reset, and red when it is more than 20% faster.

```
5h ▕██23%░░░░░░░░▏ ◆ +6.2/h ⟳ 14:30  │  week ▕████41%░░░░░░▏ ◆ +0.8/h ⟳ mon 09:00
```

The rate is computed from the readings this session receives, so it covers all your usage on the account, whatever session or app it comes from. Nothing is shown on an API-key account.

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
