// 鶏・たまごの状態の判定

/** 最終通信がこの時間以内ならオンラインとみなす（鶏は30秒ごとに device-sync を呼ぶ） */
export const DEVICE_ONLINE_MS = 2 * 60 * 1000;

export function isOnline(lastSeen: string | null, now: Date = new Date()): boolean {
  if (!lastSeen) {
    return false;
  }
  return now.getTime() - new Date(lastSeen).getTime() <= DEVICE_ONLINE_MS;
}
