export interface FstikStickerSet {
  name: string;
  title: string;
  kind: string;
  stickers: {
    file_id: string;
    emoji: string;
    width: number;
    height: number;
    thumb?: { file_id: string; width: number; height: number };
  }[];
}

export interface FstikSearchResult {
  ok: boolean;
  result: { stickerSets: FstikStickerSet[] };
}

const HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
  origin: "https://fstik.app",
  referer: "https://fstik.app/",
};

export async function searchStickerSets(
  query: string,
  limit = 10,
  skip = 0,
): Promise<FstikStickerSet[]> {
  const res = await fetch("https://api.fstik.app/searchStickerSet", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      query,
      limit,
      skip,
      type: "",
      user_token: null,
      kind: "custom_emoji",
    }),
  });
  const data = (await res.json()) as FstikSearchResult;
  if (!data.ok) throw new Error("fstik API error");
  return data.result.stickerSets;
}
