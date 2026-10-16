import { ChickenRegistration } from "@/components/device/ChickenRegistration";
import { Stat, StatGrid } from "@/components/ui/Stat";
import { EGG_PLACE_LABEL, eggPlace, isOnline, parseDeviceStatus, type DeviceStatus } from "@/lib/data/devices";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type Device = {
  id: string;
  type: string;
  mac_address: string;
  firmware_version: string;
  last_seen: string | null;
  battery_level: number | null;
  status: DeviceStatus;
};

function OnlinePill({ online }: { online: boolean }) {
  return <span className={`pill ml-auto ${online ? "pill-blue" : "pill-pink"}`}>{online ? "オンライン" : "オフライン"}</span>;
}

function LastSeenRow({ lastSeen }: { lastSeen: string | null }) {
  return (
    <div className="row">
      <span className="row-label">最終通信</span>
      <span className="row-sub">{lastSeen ? formatDateTime(lastSeen) : "まだ通信していません"}</span>
    </div>
  );
}

const fmt = (value: number | undefined, digits: number, unit: string) =>
  value === undefined ? "—" : `${value.toFixed(digits)}${unit}`;

// デバイス（T-104）：鶏・たまご・巣の状態と、鶏の登録。たまごは鶏が送るデータから自動で登録される
export default async function DevicePage() {
  const supabase = await createClient();
  const [devicesResult, activeResult] = await Promise.all([
    supabase.from("devices").select("id, type, mac_address, firmware_version, last_seen, battery_level, status"),
    supabase.from("sleep_sessions").select("id").eq("status", "in_progress").maybeSingle(),
  ]);
  if (devicesResult.error) throw new Error(`デバイスを読めませんでした: ${devicesResult.error.message}`);

  const devices: Device[] = devicesResult.data.map((d) => ({ ...d, status: parseDeviceStatus(d.status) }));
  const chicken = devices.find((d) => d.type === "chicken");
  const egg = devices.find((d) => d.type === "egg");
  const chickenOnline = chicken ? isOnline(chicken.last_seen) : false;
  const status = chicken?.status ?? {};
  const place = chicken ? eggPlace(status, Boolean(activeResult.data)) : "unknown";

  return (
    <>
      {/* 🐔 鶏 */}
      <div className="card">
        <div className="dev-card-head">
          <div className="device-icon" aria-hidden>
            🐔
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold">にわとり本体</div>
            <div className="muted">{chicken ? chicken.mac_address : "まだ登録されていません"}</div>
          </div>
          {chicken && <OnlinePill online={chickenOnline} />}
        </div>

        {chicken ? (
          <>
            {status.alarm_ringing && <p className="hint">⏰ いまアラームが鳴っています</p>}
            <StatGrid>
              <Stat label="🌡 室温" value={fmt(status.temperature_c, 1, "℃")} />
              <Stat label="💧 湿度" value={fmt(status.humidity_pct, 0, "%")} />
              <Stat label="💡 明るさ" value={fmt(status.illuminance_lux, 0, "lx")} />
              <Stat label="📶 接続" value={<span className="text-sm">{chickenOnline ? "オンライン" : "オフライン"}</span>} />
            </StatGrid>
            <LastSeenRow lastSeen={chicken.last_seen} />
            <div className="row">
              <span className="row-label">ソフトの版</span>
              <span className="row-sub font-num">{chicken.firmware_version}</span>
            </div>
            <ChickenRegistration currentMac={chicken.mac_address} />
          </>
        ) : (
          <>
            <p className="muted mb-2">
              鶏を登録すると、鶏が計測したデータがこのアカウントに記録されます。登録すると「トークン」が表示されるので、鶏の設定ファイル（.env）に書きます。
            </p>
            <ChickenRegistration currentMac={null} />
          </>
        )}
      </div>

      {/* 🥚 たまご */}
      <div className="card">
        <div className="dev-card-head">
          <div className="device-icon" aria-hidden>
            🥚
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold">たまごセンサー</div>
            <div className="muted">{egg ? EGG_PLACE_LABEL[place] : "まだ登録されていません"}</div>
          </div>
          {egg && <OnlinePill online={isOnline(egg.last_seen)} />}
        </div>
        {egg ? (
          <>
            <div className="row">
              <span className="row-label">バッテリー</span>
              <span className={`pill ${egg.battery_level != null && egg.battery_level <= 20 ? "pill-pink" : "pill-blue"}`}>
                {egg.battery_level != null ? `${egg.battery_level}%` : "不明"}
              </span>
            </div>
            <div className="row">
              <span className="row-label">MAC アドレス</span>
              <span className="row-sub font-num">{egg.mac_address}</span>
            </div>
            <LastSeenRow lastSeen={egg.last_seen} />
          </>
        ) : (
          <p className="muted">登録は不要です。鶏の電源を入れて、たまごと BLE でつながると自動で登録されます。</p>
        )}
      </div>

      {/* 🪺 巣 */}
      <div className="card">
        <div className="dev-card-head">
          <div className="device-icon" aria-hidden>
            🪺
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold">巣（充電ステーション）</div>
            <div className="muted">
              {place === "nest" ? "たまごを充電中" : place === "unknown" || place === "disconnected" ? "わかりません" : "たまごはありません"}
            </div>
          </div>
        </div>
        <p className="muted">たまごを巣に戻すと充電が始まり、鶏のアラームが止まります（二度寝防止）。</p>
      </div>
    </>
  );
}
