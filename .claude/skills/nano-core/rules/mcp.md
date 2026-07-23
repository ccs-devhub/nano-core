---
title: The MCP Bridge — Driving the Live Bot from an AI Session
impact: HIGH
impactDescription: Answering live-bot questions from code guesses instead of the MCP tools produces stale or wrong answers; ungated writes or leaked tokens break the security model.
tags: mcp, model-context-protocol, ai-bridge, mcp-module, tools, bot-vitals, guild-snapshot, NANO_MCP_TOKEN, .mcp.json, allow_write, allow_moderation, streamable-http
---

The `mcp` module runs a Model Context Protocol server INSIDE the bot
process (loopback Streamable HTTP, default `http://127.0.0.1:3777/mcp`).
The repo `.mcp.json` connects this Claude Code session to it as the
`nano-core` MCP server. Every tool wraps one NanoResult API call:
plain ids in, the JSON envelope out.

## When to use the MCP tools

Use them whenever the question is about the LIVE bot, not the code:
"what guilds is the bot in", "show the channels of guild X", "is the
bot healthy", "what jobs are scheduled", "send a test message". Never
answer those from code reading — call the tool. For questions about
how the code works, read the code as usual.

## Preconditions (check in this order when tools fail)

1. The bot process must be RUNNING (`npm run dev`, or the TUI Bot
   view). Connection refused means it is not.
2. The `mcp` module must be enabled in `nano.config.json` and
   `NANO_MCP_TOKEN` must be set in `.env` AND exported in the shell
   Claude Code runs in (the `.mcp.json` header expands `${NANO_MCP_TOKEN}`).
3. HTTP 401 means the session token and the bot token differ.
4. A "Bot not ready" error content means the gateway is still
   connecting - retry in a few seconds.
5. A missing tool (e.g. `send_message` not in the list) means its gate
   is off: `module_config.mcp.allow_write` / `allow_moderation` in
   `nano.config.json`, restart required after changing.

## The tool surface

- Always registered (read): `bot_vitals`, `list_modules`, `list_jobs`,
  `list_guilds`, `guild_snapshot`, `list_channels`, `get_channel`,
  `list_roles`, `list_members`, `get_member`, `fetch_messages`.
- `allow_write` gate: `send_message`, `edit_message`,
  `delete_message`, `bulk_delete_messages`, `react_to_message`,
  `pin_message`, `unpin_message`, channel create/edit/delete, role
  create/edit/delete, `add_role_to_member`, `remove_role_from_member`,
  `set_nickname`.
- `allow_moderation` gate: `kick_member`, `ban_member`,
  `unban_member`, `timeout_member`.

Results are the NanoResult envelope: successful calls return
`data` serialized as JSON text; failures return the error string with
the MCP `isError` flag. Treat `{ok:false}`-style error text as a
normal, explainable outcome - not an exception.

## Security laws

- The token lives ONLY in env (`NANO_MCP_TOKEN`); never write it into
  nano.config.json, docs, or committed files.
- The server binds loopback only, on purpose. Do not "fix" that.
- Write/moderation tools stay gate-off by default. Never flip a gate
  in nano.config.json without the owner asking for it.
- In-Discord status check: the `/mcp` command (administrator only)
  shows endpoint state, port, tool count, and gates.
