import type { Metadata } from "next";

import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "ログイン | ねるコッコ",
};

export default function LoginPage() {
  return (
    <div className="phase-screen" data-phase="dusk">
      <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col justify-center px-4 py-10">
        <div className="mb-6 text-center">
          <div className="text-5xl" aria-hidden>
            🐔
          </div>
          <h1 className="mt-2 font-maru text-3xl font-black">ねるコッコ</h1>
          <p className="muted mt-1">にわとりと一緒に整える朝と夜</p>
        </div>
        <LoginForm />
      </main>
    </div>
  );
}
