"use server";

import { revalidatePath } from "next/cache";

import { normalizeMacInput } from "@/lib/data/devices";
import { createClient } from "@/lib/supabase/server";

export type RegisterChickenState = {
  error?: string;
  /** 鶏の .env に書くトークン。このときだけ画面に出す（DB にはハッシュしか残らない） */
  token?: string;
  /** 送信後にフォームが空に戻っても入力が残るよう、入力値を返す */
  mac?: string;
};

/**
 * 鶏を登録する（docs/api-spec.md §2）。同じ MAC ならトークンの再発行、別の MAC なら鶏の交換になる。
 * たまごは、鶏が送るデータから自動で登録されるので、ここでは扱わない。
 */
export async function registerChicken(_prev: RegisterChickenState, formData: FormData): Promise<RegisterChickenState> {
  const input = String(formData.get("mac_address") ?? "");
  const mac = normalizeMacInput(input);
  if (!mac) {
    return { error: "MACアドレスの形式が正しくありません（例：B8:27:EB:12:34:56）", mac: input };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("register_device", { p_type: "chicken", p_mac_address: mac })
    .single();
  if (error) {
    // 22023 は入力の誤り（DB 側の文言をそのまま出す）、42501 は別のユーザーの機体
    if (error.code === "42501") return { error: "この鶏は別のアカウントに登録されています", mac };
    if (error.code === "22023") return { error: error.message, mac };
    return { error: "登録できませんでした。時間をおいて試してください", mac };
  }
  if (!data?.device_token) return { error: "トークンを発行できませんでした", mac };

  revalidatePath("/", "layout");
  return { token: data.device_token, mac };
}
