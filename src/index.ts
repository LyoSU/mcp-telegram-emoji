import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync, readFileSync } from "fs";
import sharp from "sharp";
import { Cache } from "./cache.js";
import { getStickerSet, downloadFile } from "./telegram.js";
import { searchStickerSets } from "./fstik.js";
import type { CachedEmoji } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const PREVIEWS_DIR = join(DATA_DIR, "previews");
const CACHE_FILE = join(DATA_DIR, "emoji-cache.json");

if (!existsSync(PREVIEWS_DIR)) mkdirSync(PREVIEWS_DIR, { recursive: true });

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const cache = new Cache(CACHE_FILE);

// --- Sprite sheet generation ---

const GRID_COLS = 8;
const THUMB_SIZE = 100;
const LABEL_HEIGHT = 20;
const CELL_H = THUMB_SIZE + LABEL_HEIGHT;

async function generateSpriteSheet(
  packName: string,
  emojis: CachedEmoji[],
  thumbnailBuffers: Buffer[],
): Promise<string> {
  const rows = Math.ceil(emojis.length / GRID_COLS);
  const width = GRID_COLS * THUMB_SIZE;
  const height = rows * CELL_H;

  const composites: sharp.OverlayOptions[] = [];

  for (let i = 0; i < emojis.length; i++) {
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    const x = col * THUMB_SIZE;
    const y = row * CELL_H;

    if (thumbnailBuffers[i] && thumbnailBuffers[i].length > 0) {
      try {
        const resized = await sharp(thumbnailBuffers[i])
          .resize(THUMB_SIZE, THUMB_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer();
        composites.push({ input: resized, left: x, top: y });
      } catch {
        // skip broken thumbnails
      }
    }

    // Label: index number + last 6 chars of id (no emoji — renders as black squares in SVG)
    const idx = i + 1;
    const shortId = emojis[i].custom_emoji_id.slice(-6);
    const label = `#${idx} …${shortId}`;
    const svgLabel = `<svg width="${THUMB_SIZE}" height="${LABEL_HEIGHT}">
      <text x="2" y="14" font-size="11" font-family="monospace" fill="#666">${escapeXml(label)}</text>
    </svg>`;
    composites.push({
      input: Buffer.from(svgLabel),
      left: x,
      top: y + THUMB_SIZE,
    });
  }

  const outPath = join(PREVIEWS_DIR, `${packName}.png`);
  await sharp({
    create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite(composites)
    .png()
    .toFile(outPath);

  return outPath;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// --- Helper: sync via Telegram Bot API (real custom_emoji_id + thumbnails) ---

async function syncViaTelegram(name: string): Promise<{ emojis: CachedEmoji[]; thumbs: Buffer[]; title: string }> {
  if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN not set — required for syncing with real custom_emoji_id and thumbnails");
  const set = await getStickerSet(TOKEN, name);

  const emojis: CachedEmoji[] = set.stickers.map((s) => ({
    custom_emoji_id: s.custom_emoji_id ?? s.file_unique_id,
    emoji: s.emoji ?? "❓",
    set_name: name,
    thumbnail_file_id: s.thumbnail?.file_id,
  }));

  // Download all thumbnails in parallel (no rate limits on Telegram file API)
  const results = await Promise.allSettled(
    set.stickers.map((s) =>
      s.thumbnail ? downloadFile(TOKEN!, s.thumbnail.file_id) : Promise.resolve(Buffer.alloc(0)),
    ),
  );
  const thumbs = results.map((r) => (r.status === "fulfilled" ? r.value : Buffer.alloc(0)));

  return { emojis, thumbs, title: set.title };
}

// --- MCP Server ---

const server = new McpServer(
  {
    name: "telegram-emoji",
    version: "1.0.0",
  },
  {
    instructions: `This server exposes custom emoji for Telegram messages.

## Workflow
1. search_packs → find packs by keyword on fstik.app
2. sync_emoji_pack → download pack via Telegram Bot API (gets real custom_emoji_id + thumbnails)
3. get_pack → ALWAYS look at the sprite sheet preview to see what emojis actually look like
4. Pick emojis visually from the sprite sheet, NEVER guess by unicode fallback
5. send_message → send with <tg-emoji> HTML tags

## Style rules for posts
- Use 1 custom emoji per section header — don't spam every line
- Keep it clean: emoji before bold title, plain text for content
- Pick emojis that match the section meaning (e.g. 🔥 for hot news, 💬 for chat features)
- Max 5-8 custom emojis per post, not more`,
  },
);

server.tool(
  "search_packs",
  "Search for custom emoji packs on fstik.app. Returns pack names — then use sync_emoji_pack to download them.",
  {
    query: z.string().describe("Search query (e.g. 'icon', 'fire', 'cat', 'neon', 'gradient')"),
    limit: z.number().optional().default(10).describe("Max results"),
  },
  async ({ query, limit }) => {
    try {
      const sets = await searchStickerSets(query, limit);
      if (sets.length === 0) {
        return { content: [{ type: "text", text: `No packs found for "${query}"` }] };
      }
      const lines = sets.map(
        (s) => `${s.name} — ${s.title} (${s.stickers.length} emojis)`,
      );
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `fstik search error: ${err.message}` }] };
    }
  },
);

server.tool(
  "sync_emoji_pack",
  `Sync a custom emoji sticker set via Telegram Bot API. Downloads real custom_emoji_id values and thumbnails, generates a preview sprite sheet.
After syncing, ALWAYS call get_pack to see the visual preview before using any emojis.`,
  {
    pack_name: z.string().optional().describe("Sticker set name to sync. If omitted, syncs all packs from EMOJI_PACKS env."),
  },
  async ({ pack_name }) => {
    const names = pack_name
      ? [pack_name]
      : (process.env.EMOJI_PACKS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []);

    if (names.length === 0) {
      return { content: [{ type: "text", text: "No pack name provided and EMOJI_PACKS env is empty." }] };
    }

    const results: string[] = [];

    for (const name of names) {
      try {
        const { emojis, thumbs, title } = await syncViaTelegram(name);
        const previewPath = await generateSpriteSheet(name, emojis, thumbs);
        cache.setPack({ name, title, emojis, synced_at: new Date().toISOString(), preview_path: previewPath });
        results.push(`✓ ${name} (${title}): ${emojis.length} emojis synced with preview`);
      } catch (err: any) {
        results.push(`✗ ${name}: ${err.message}`);
      }
    }

    return { content: [{ type: "text", text: results.join("\n") }] };
  },
);

server.tool("list_packs", "List all synced emoji packs with emoji counts. Use get_pack to see visual previews.", {}, async () => {
  const packs = cache.listPacks();
  if (packs.length === 0) {
    return { content: [{ type: "text", text: "No packs synced yet. Use search_packs to find packs, then sync_emoji_pack to download." }] };
  }
  const lines = packs.map((p) => `${p.name} — ${p.title} (${p.count} emojis)`);
  return { content: [{ type: "text", text: lines.join("\n") }] };
});

server.tool(
  "get_pack",
  `Get all emojis from a synced pack with visual preview sprite sheet.
IMPORTANT: Always look at the preview image to see what each emoji actually looks like before selecting emojis for messages. The sprite sheet shows thumbnails in a grid with index numbers and IDs.`,
  {
    pack_name: z.string().describe("Sticker set name"),
  },
  async ({ pack_name }) => {
    const pack = cache.getPack(pack_name);
    if (!pack) {
      return { content: [{ type: "text", text: `Pack "${pack_name}" not found. Run sync_emoji_pack first.` }] };
    }

    const lines = pack.emojis.map(
      (e, i) => `#${i + 1}  ${e.emoji}  id:${e.custom_emoji_id}`,
    );
    const text = `${pack.title} (${pack.emojis.length} emojis)\n\n${lines.join("\n")}`;

    const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
      { type: "text", text },
    ];

    if (pack.preview_path && existsSync(pack.preview_path)) {
      const imgData = readFileSync(pack.preview_path).toString("base64");
      content.push({ type: "image", data: imgData, mimeType: "image/png" });
    } else {
      content.push({ type: "text", text: "\n⚠️ No preview image available. Re-sync pack to generate one." });
    }

    return { content };
  },
);

server.tool(
  "search_emoji",
  "Search synced emojis by unicode fallback character or custom_emoji_id substring. For visual selection, use get_pack instead to see the sprite sheet.",
  { query: z.string().describe("Search query — unicode emoji or id substring") },
  async ({ query }) => {
    const results = cache.searchEmoji(query);
    if (results.length === 0) {
      return { content: [{ type: "text", text: `No emojis found for "${query}"` }] };
    }
    const lines = results.map(
      (e) => `${e.emoji}  id:${e.custom_emoji_id}  pack:${e.set_name}`,
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

server.tool(
  "get_emoji",
  "View a single emoji full-size by index number (from sprite sheet) or custom_emoji_id. Use this to inspect a specific emoji before using it.",
  {
    pack_name: z.string().describe("Sticker set name"),
    index: z.number().optional().describe("1-based index from sprite sheet (e.g. #3 → index 3)"),
    emoji_id: z.string().optional().describe("custom_emoji_id to look up"),
  },
  async ({ pack_name, index, emoji_id }) => {
    const pack = cache.getPack(pack_name);
    if (!pack) {
      return { content: [{ type: "text", text: `Pack "${pack_name}" not found.` }] };
    }

    let emoji: typeof pack.emojis[0] | undefined;
    let idx: number | undefined;

    if (index !== undefined) {
      idx = index - 1;
      emoji = pack.emojis[idx];
    } else if (emoji_id) {
      idx = pack.emojis.findIndex((e) => e.custom_emoji_id === emoji_id);
      emoji = idx >= 0 ? pack.emojis[idx] : undefined;
    }

    if (!emoji || idx === undefined || idx < 0) {
      return { content: [{ type: "text", text: "Emoji not found. Use get_pack to see the sprite sheet with index numbers." }] };
    }

    const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
      { type: "text", text: `#${idx + 1}  ${emoji.emoji}  id: ${emoji.custom_emoji_id}\npack: ${emoji.set_name}` },
    ];

    // Download thumbnail using cached file_id (no need to re-fetch entire sticker set)
    if (TOKEN && emoji.thumbnail_file_id) {
      try {
        const buf = await downloadFile(TOKEN, emoji.thumbnail_file_id);
        const resized = await sharp(buf)
          .resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer();
        content.push({ type: "image", data: resized.toString("base64"), mimeType: "image/png" });
      } catch {
        content.push({ type: "text", text: "(Could not load preview image)" });
      }
    }

    return { content };
  },
);

server.tool(
  "format_message",
  "Format text with custom emoji placeholders into Telegram MarkdownV2 or HTML. Use :emoji_fallback: or {custom_emoji_id} as placeholders.",
  {
    text: z.string().describe("Text with emoji placeholders like :🔥: or {5368324170671202286}"),
    format: z.enum(["html", "markdownv2"]).default("html").describe("Output format"),
  },
  async ({ text, format }) => {
    const allEmojis = cache.allEmojis();

    let result = text;

    // Replace {custom_emoji_id} placeholders
    result = result.replace(/\{(\d+)\}/g, (_, id) => {
      const e = allEmojis.find((em) => em.custom_emoji_id === id);
      const fallback = e?.emoji ?? "❓";
      if (format === "html") {
        return `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
      }
      return `![${fallback}](tg://emoji?id=${id})`;
    });

    // Replace :emoji: placeholders (unicode emoji between colons)
    result = result.replace(/:([^:]+):/g, (match, inner) => {
      const norm = inner.replace(/\uFE0F/g, "");
      const e = allEmojis.find((em) => em.emoji.replace(/\uFE0F/g, "") === norm);
      if (!e) return match;
      if (format === "html") {
        return `<tg-emoji emoji-id="${e.custom_emoji_id}">${e.emoji}</tg-emoji>`;
      }
      return `![${e.emoji}](tg://emoji?id=${e.custom_emoji_id})`;
    });

    return { content: [{ type: "text", text: result }] };
  },
);

server.tool(
  "send_message",
  "Send a Telegram message with custom emoji (HTML parse_mode). Use <tg-emoji emoji-id=\"ID\">fallback</tg-emoji> for custom emojis in the text.",
  {
    chat_id: z.string().describe("Telegram chat ID to send to"),
    text: z.string().describe("HTML-formatted message text with <tg-emoji> tags"),
  },
  async ({ chat_id, text }) => {
    if (!TOKEN) {
      return { content: [{ type: "text", text: "TELEGRAM_BOT_TOKEN not set" }] };
    }
    if (text.length > 4096) {
      return { content: [{ type: "text", text: `Message too long: ${text.length}/4096 chars` }] };
    }
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id, text, parse_mode: "HTML" }),
    });
    const data = await res.json() as any;
    if (!data.ok) {
      return { content: [{ type: "text", text: `Telegram error: ${data.description}` }] };
    }
    return { content: [{ type: "text", text: `✓ Message sent (id: ${data.result.message_id})` }] };
  },
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("telegram-emoji MCP server running");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
