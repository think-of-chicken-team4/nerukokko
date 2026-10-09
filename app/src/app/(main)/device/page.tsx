import { isOnline } from "@/lib/data/devices";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const DEVICE_INFO = {
  chicken: { icon: "🐔", name: "にわとり本体" },
  egg: { icon: "🥚", name: "たまごセンサー" },
} as const;

// デバイス。いまは登録済みのデバイスの一覧だけ。登録フォームと詳しい状態は T-104 で作る。
export default async function DevicePage() {
  const supabase = await createClient();
  const { data: devices } = await supabase
    .from("devices")
    .select("id, type, mac_address, last_seen, battery_level")
    .order("type");

  if (!devices || devices.length === 0) {
    return (
      <div className="card">
        <h2 className="card-title">🐔 デバイス</h2>
        <p className="muted">まだデバイスが登録されていません。</p>
      </div>
    );
  }

  return devices.map((device) => {
    const info = DEVICE_INFO[device.type as keyof typeof DEVICE_INFO];
    const online = isOnline(device.last_seen);
    return (
      <div key={device.id} className="card">
        <div className="dev-card-head">
          <div className="device-icon" aria-hidden>
            {info.icon}
          </div>
          <div>
            <div className="text-sm font-bold">{info.name}</div>
            <div className="muted">{device.mac_address}</div>
          </div>
          <span className={`pill ml-auto ${online ? "pill-blue" : "pill-pink"}`}>{online ? "オンライン" : "オフライン"}</span>
        </div>
        <div className="row">
          <span className="row-label">最終通信</span>
          <span className="row-sub">{device.last_seen ? formatDateTime(device.last_seen) : "まだ通信していません"}</span>
        </div>
        {device.type === "egg" && (
          <div className="row">
            <span className="row-label">バッテリー</span>
            <span className="row-sub">{device.battery_level != null ? `${device.battery_level}%` : "不明"}</span>
          </div>
        )}
      </div>
    );
  });
}
