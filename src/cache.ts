import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { EmojiCache, CachedPack } from "./types.js";

// Strip U+FE0F (variation selector-16) for consistent emoji matching
function stripVariationSelectors(s: string): string {
  return s.replace(/\uFE0F/g, "");
}

export class Cache {
  private data: EmojiCache;

  constructor(private filePath: string) {
    if (existsSync(filePath)) {
      this.data = JSON.parse(readFileSync(filePath, "utf-8"));
    } else {
      this.data = { packs: {} };
    }
  }

  save() {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  setPack(pack: CachedPack) {
    this.data.packs[pack.name] = pack;
    this.save();
  }

  getPack(name: string): CachedPack | undefined {
    return this.data.packs[name];
  }

  listPacks(): { name: string; title: string; count: number }[] {
    return Object.values(this.data.packs).map((p) => ({
      name: p.name,
      title: p.title,
      count: p.emojis.length,
    }));
  }

  searchEmoji(query: string) {
    if (!query || query.trim().length === 0) return [];
    const q = stripVariationSelectors(query.toLowerCase().trim());
    const results: { custom_emoji_id: string; emoji: string; set_name: string }[] = [];
    for (const pack of Object.values(this.data.packs)) {
      for (const e of pack.emojis) {
        const emojiNorm = stripVariationSelectors(e.emoji);
        if (emojiNorm.includes(q) || e.custom_emoji_id.includes(q)) {
          results.push(e);
        }
      }
    }
    return results;
  }

  allEmojis() {
    const all: { custom_emoji_id: string; emoji: string; set_name: string }[] = [];
    for (const pack of Object.values(this.data.packs)) {
      all.push(...pack.emojis);
    }
    return all;
  }
}
