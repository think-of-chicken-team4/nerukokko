"use client";

import { useFormStatus } from "react-dom";

import { disconnectCalendar, startCalendarLink } from "@/app/(main)/settings/actions";

function SubmitButton({ label, pendingLabel, variant }: { label: string; pendingLabel: string; variant: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn ${variant}`} disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

type Props = {
  connected: boolean;
  /** 連携した日時（表示用に整えたもの） */
  connectedAt: string | null;
  message: { ok: boolean; text: string } | null;
};

// 設定 →「📅 カレンダー連携」（T-205）。連携すると、夕方の就寝提案で明日の最初の予定を見る
export function CalendarSettings({ connected, connectedAt, message }: Props) {
  return (
    <div className="card">
      <h2 className="card-title">📅 カレンダー連携</h2>
      {message && <p className={message.ok ? "hint" : "error-text"}>{message.text}</p>}
      {connected ? (
        <>
          <div className="row">
            <div>
              <div className="row-label">Googleカレンダー</div>
              <div className="row-sub">連携中{connectedAt && `（${connectedAt}から）`}</div>
            </div>
            <span className="pill pill-blue">連携中</span>
          </div>
          <p className="muted mb-1">明日の最初の予定の90分前に起きられるよう、就寝時刻を提案します。予定の内容を書き換えることはありません。</p>
          <form action={disconnectCalendar}>
            <SubmitButton label="連携を解除する" pendingLabel="解除中…" variant="btn-secondary" />
          </form>
        </>
      ) : (
        <>
          <p className="muted mb-1">
            Googleカレンダーの明日の予定を読み取り、間に合う時刻に起きられるよう就寝時刻を提案します（読み取りだけで、書き換えはしません）。
          </p>
          <form action={startCalendarLink}>
            <SubmitButton label="Googleカレンダーと連携する" pendingLabel="Google に移動中…" variant="btn-primary" />
          </form>
        </>
      )}
    </div>
  );
}
