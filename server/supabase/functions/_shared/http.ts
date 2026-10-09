// Edge Functions で共通の HTTP まわり（エラーの形式・CORS・JSON の読み込み）。docs/api-spec.md §1

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types.ts";

export type Db = SupabaseClient<Database>;
export type TableName = keyof Database["public"]["Tables"];

/** 鶏のヘッダー（x-device-token）もブラウザ（デバイスシミュレーター）から送れるようにする */
export const CORS = {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  },
};

/** docs/api-spec.md §1-4 のエラー形式 */
export function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/** JSON の本文を読む。大きすぎる・JSON でないときはエラーのレスポンスを返す */
export async function readJson(req: Request, maxBytes: number): Promise<unknown | Response> {
  if (req.method !== "POST") {
    return jsonError(405, "method_not_allowed", "POST で送ってください");
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    return jsonError(413, "payload_too_large", `本文は${Math.floor(maxBytes / 1024)}KBまでです`);
  }
  try {
    return text.length === 0 ? {} : JSON.parse(text);
  } catch {
    return jsonError(400, "invalid_json", "JSON の形式が正しくありません");
  }
}

/** PostgREST の上限（1000件）を超えても全件読めるよう、1000件ずつ読む */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const size = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < size) return rows;
  }
}

/**
 * レスポンスを返したあとも処理を続ける（Supabase Edge Runtime の EdgeRuntime.waitUntil）。
 * 型定義に頼らず globalThis から呼ぶ。EdgeRuntime がない環境では、そのまま待たずに実行する。
 */
export function runInBackground(task: Promise<unknown>, label: string): void {
  const guarded = task.catch((error) => console.error(`${label} failed`, error));
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime;
  runtime?.waitUntil(guarded);
}
