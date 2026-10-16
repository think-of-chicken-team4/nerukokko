// 鶏の認証とたまごの自動登録（docs/api-spec.md §2）

import type { Database } from "./database.types.ts";
import { type Db, jsonError } from "./http.ts";

export type Device = Database["public"]["Tables"]["devices"]["Row"];

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** x-device-token ヘッダーから鶏を特定する。失敗したらエラーのレスポンスを返す */
export async function authenticateChicken(req: Request, db: Db): Promise<Device | Response> {
  const token = req.headers.get("x-device-token");
  if (!token) {
    return jsonError(401, "missing_token", "x-device-token ヘッダーがありません");
  }
  const { data: tokenRow, error } = await db
    .from("device_tokens")
    .select("device_id")
    .eq("token_hash", await sha256Hex(token))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!tokenRow) {
    return jsonError(401, "invalid_token", "デバイストークンが正しくありません");
  }
  const { data: device, error: deviceError } = await db
    .from("devices")
    .select("*")
    .eq("id", tokenRow.device_id)
    .eq("type", "chicken")
    .maybeSingle();
  if (deviceError) throw new Error(deviceError.message);
  if (!device) {
    return jsonError(404, "device_not_found", "鶏が登録されていません");
  }
  return device;
}

/**
 * 鶏が送ってきた MAC アドレスのたまごを返す。未登録なら、鶏と同じユーザーのたまごとして登録する。
 * ユーザーにすでに別のたまごがあれば MAC アドレスを置き換える（機体の交換。計測データは残る）。
 * 別のユーザーのたまごだった場合は null（データは記録しない）。
 */
export async function resolveEgg(db: Db, userId: string, macAddress: string): Promise<Device | null> {
  const { data: byMac, error } = await db.from("devices").select("*").eq("mac_address", macAddress).maybeSingle();
  if (error) throw new Error(error.message);
  if (byMac) {
    return byMac.user_id === userId && byMac.type === "egg" ? byMac : null;
  }

  const { data: current, error: currentError } = await db
    .from("devices")
    .select("*")
    .eq("user_id", userId)
    .eq("type", "egg")
    .maybeSingle();
  if (currentError) throw new Error(currentError.message);

  const { data: saved, error: saveError } = current
    ? await db
        .from("devices")
        .update({ mac_address: macAddress, paired_at: new Date().toISOString(), battery_level: null })
        .eq("id", current.id)
        .select("*")
        .single()
    : await db.from("devices").insert({ user_id: userId, type: "egg", mac_address: macAddress }).select("*").single();
  if (saveError) throw new Error(saveError.message);
  return saved;
}
