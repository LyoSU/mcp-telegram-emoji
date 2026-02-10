import type { TgStickerSet } from "./types.js";

const BASE = "https://api.telegram.org/bot";
const TIMEOUT_MS = 30_000;

function apiUrl(token: string, method: string) {
  return `${BASE}${token}/${method}`;
}

async function fetchWithTimeout(url: string, opts?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function getStickerSet(
  token: string,
  name: string,
): Promise<TgStickerSet> {
  const res = await fetchWithTimeout(
    apiUrl(token, "getStickerSet") + `?name=${encodeURIComponent(name)}`,
  );
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API: ${data.description}`);
  return data.result as TgStickerSet;
}

export async function getFileUrl(
  token: string,
  fileId: string,
): Promise<string> {
  const res = await fetchWithTimeout(
    apiUrl(token, "getFile") + `?file_id=${encodeURIComponent(fileId)}`,
  );
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API: ${data.description}`);
  return `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
}

export async function downloadFile(
  token: string,
  fileId: string,
): Promise<Buffer> {
  const url = await getFileUrl(token, fileId);
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
