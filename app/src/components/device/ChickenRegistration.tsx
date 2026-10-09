"use client";

import { useActionState, useState } from "react";

import { registerChicken, type RegisterChickenState } from "@/app/(main)/device/actions";

type Mode = "closed" | "replace";

// 鶏の登録・トークンの再発行・別の鶏への交換（T-104、docs/api-spec.md §2）
export function ChickenRegistration({ currentMac }: { currentMac: string | null }) {
  const [state, action, pending] = useActionState<RegisterChickenState, FormData>(registerChicken, {});
  const [mode, setMode] = useState<Mode>("closed");

  if (state.token) {
    return <TokenPanel token={state.token} />;
  }

  // まだ鶏がいない、または交換するとき：MAC アドレスを入れて登録する
  if (!currentMac || mode === "replace") {
    return (
      <form action={action} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="row-label">{currentMac ? "新しい鶏の MAC アドレス" : "鶏の MAC アドレス"}</span>
          <input
            name="mac_address"
            className="input"
            placeholder="B8:27:EB:12:34:56"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            defaultValue={state.mac}
            required
          />
        </label>
        <p className="hint mb-0">
          鶏（ラズパイ）のターミナルで <code className="font-num">cat /sys/class/net/wlan0/address</code> と打つと表示されます（Wi-Fi の MAC アドレス）。
        </p>
        {state.error && <p className="error-text">{state.error}</p>}
        {currentMac && (
          <p className="muted">交換すると、今の鶏のトークンは使えなくなります。これまでの記録は残ります。</p>
        )}
        <div className="btn-row">
          {currentMac && (
            <button type="button" className="btn btn-sm btn-secondary" disabled={pending} onClick={() => setMode("closed")}>
              やめる
            </button>
          )}
          <button type="submit" className="btn btn-sm btn-primary" disabled={pending}>
            {pending ? "登録中…" : "登録してトークンを発行"}
          </button>
        </div>
      </form>
    );
  }

  // 登録済み：トークンの再発行（同じ MAC で登録し直す）と、別の鶏への交換
  return (
    <form
      action={action}
      className="btn-row mt-2"
      onSubmit={(e) => {
        if (!confirm("トークンを作り直しますか？今のトークンは使えなくなり、鶏の .env を書き換える必要があります")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="mac_address" value={currentMac} />
      <button type="submit" className="btn btn-sm btn-secondary" disabled={pending}>
        {pending ? "発行中…" : "🔑 トークンを再発行"}
      </button>
      <button type="button" className="btn btn-sm btn-secondary" disabled={pending} onClick={() => setMode("replace")}>
        🔁 別の鶏に交換
      </button>
      {state.error && <p className="error-text">{state.error}</p>}
    </form>
  );
}

function TokenPanel({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const line = `DEVICE_TOKEN=${token}`;

  return (
    <div className="flex flex-col gap-2">
      <p className="row-label">✅ 登録しました。次の1行を、鶏の <code>.env</code> に書いてください。</p>
      <code className="block rounded-xl bg-[var(--inset)] p-3 font-num text-[12px] break-all select-all">{line}</code>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(line);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "コピーしました" : "コピーする"}
      </button>
      <p className="hint mb-0">
        ⚠️ このトークンは<b>今だけ</b>表示されます。画面を離れると二度と見られません（なくしたら「トークンを再発行」）。人に見せたり、GitHub に上げたりしないでください。
      </p>
    </div>
  );
}
