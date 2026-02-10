# mcp-telegram-emoji

MCP server that gives Claude Code access to Telegram custom emoji.

Search packs on fstik.app, sync them via Bot API, preview as sprite sheets, and send messages — all from the terminal.

## Setup

```bash
npm install
```

Add to `~/.claude.json`:

```json
{
  "telegram-emoji": {
    "type": "stdio",
    "command": "./node_modules/.bin/tsx",
    "args": ["./src/index.ts"],
    "env": {
      "TELEGRAM_BOT_TOKEN": "...",
      "EMOJI_PACKS": "NewsEmoji,CenterOfEmoji98095669"
    }
  }
}
```

`EMOJI_PACKS` — comma-separated pack names to auto-sync. Optional.

## Tools

| Tool | What it does |
|------|-------------|
| `search_packs` | Search fstik.app for custom emoji packs |
| `sync_emoji_pack` | Download pack metadata + thumbnails via Bot API |
| `get_pack` | Show emoji list + sprite sheet preview |
| `get_emoji` | Single emoji full-size (by index or ID) |
| `search_emoji` | Find emoji by unicode or ID substring |
| `format_message` | `:🔥:` / `{id}` → `<tg-emoji>` HTML |
| `send_message` | Send formatted message to Telegram |

## How it works

Sprite sheets let Claude actually **see** what each emoji looks like — no guessing by unicode fallback.

```
search_packs("news")         → find packs on fstik.app
sync_emoji_pack("NewsEmoji") → download IDs + thumbnails, build sprite
get_pack("NewsEmoji")        → view the sprite sheet
send_message(chat_id, html)  → post with <tg-emoji> tags
```

Custom emoji in bot messages require the bot owner to have [Telegram Premium](https://telegram.org/blog/custom-emoji).

## Stack

TypeScript, MCP SDK, Sharp (sprites), fetch (Telegram Bot API + fstik.app). No heavy deps.
