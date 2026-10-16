"use client";

import { useActionState, useState } from "react";

import { login, signup, type AuthFormState } from "./actions";

type Mode = "login" | "signup";

export function LoginForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [loginState, loginAction, loginPending] = useActionState<AuthFormState, FormData>(login, {});
  const [signupState, signupAction, signupPending] = useActionState<AuthFormState, FormData>(signup, {});

  const isLogin = mode === "login";
  const state = isLogin ? loginState : signupState;
  const pending = isLogin ? loginPending : signupPending;

  return (
    <div className="card">
      <div className="mb-4 flex rounded-[14px] bg-[var(--inset)] p-1">
        {(["login", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-[10px] py-2 text-[12.5px] font-bold ${
              mode === m ? "bg-gold text-[#4a2c05]" : "text-[var(--fg-dim)]"
            }`}
          >
            {m === "login" ? "ログイン" : "新規登録"}
          </button>
        ))}
      </div>

      <form action={isLogin ? loginAction : signupAction} className="flex flex-col gap-3">
        {!isLogin && (
          <label className="flex flex-col gap-1">
            <span className="muted">名前（にわとりが呼ぶ名前）</span>
            <input
              name="display_name"
              type="text"
              className="input"
              autoComplete="nickname"
              defaultValue={state.displayName}
              required
            />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="muted">メールアドレス</span>
          <input name="email" type="email" className="input" autoComplete="email" defaultValue={state.email} required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="muted">パスワード{isLogin ? "" : "（8文字以上）"}</span>
          <input
            name="password"
            type="password"
            className="input"
            autoComplete={isLogin ? "current-password" : "new-password"}
            minLength={isLogin ? undefined : 8}
            required
          />
        </label>

        {state.error && <p className="error-text">{state.error}</p>}
        {state.message && <p className="muted">{state.message}</p>}

        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "送信中…" : isLogin ? "ログイン" : "登録してはじめる"}
        </button>
      </form>
    </div>
  );
}
