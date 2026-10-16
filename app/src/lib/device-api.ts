// 鶏と同じ方法で Edge Function を呼ぶ（docs/api-spec.md §1-3）。デバイスシミュレーターで使う。

export type DeviceApiResult = { status: number; body: unknown };

export async function callDeviceApi(
  name: "ingest-sensor-data" | "device-sync",
  deviceToken: string,
  body: unknown,
): Promise<DeviceApiResult> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      "x-device-token": deviceToken,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // JSON でなければ文字列のまま返す
  }
  return { status: res.status, body: parsed };
}
