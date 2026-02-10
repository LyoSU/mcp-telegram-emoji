export interface CachedEmoji {
  custom_emoji_id: string;
  emoji: string; // unicode fallback
  set_name: string;
  thumbnail_file_id?: string;
}

export interface CachedPack {
  name: string;
  title: string;
  emojis: CachedEmoji[];
  synced_at: string;
  preview_path?: string;
}

export interface EmojiCache {
  packs: Record<string, CachedPack>;
}

// Telegram API types (subset)
export interface TgSticker {
  file_id: string;
  file_unique_id: string;
  type: string;
  width: number;
  height: number;
  emoji?: string;
  custom_emoji_id?: string;
  thumbnail?: {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
  };
}

export interface TgStickerSet {
  name: string;
  title: string;
  sticker_type: string;
  stickers: TgSticker[];
}
