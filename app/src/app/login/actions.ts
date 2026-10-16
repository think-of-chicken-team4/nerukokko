"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type AuthFormState = {
  error?: string;
  message?: string;
  // 送信後にフォームが空に戻っても入力が残るよう、入力値を返す（パスワードは返さない）
  email?: string;
  displayName?: string;
};

const MIN_PASSWORD_LENGTH = 8;

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
}

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const { email, password } = readCredentials(formData);
  if (!email || !password) {
    return { error: "メールアドレスとパスワードを入力してください", email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: "メールアドレスかパスワードが違います", email };
  }
  redirect("/");
}

export async function signup(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const { email, password } = readCredentials(formData);
  const displayName = String(formData.get("display_name") ?? "").trim();
  if (!displayName || !email || !password) {
    return { error: "名前・メールアドレス・パスワードを入力してください", email, displayName };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`, email, displayName };
  }

  const supabase = await createClient();
  // full_name は DB のトリガー（handle_new_user）が users.display_name に使う
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: displayName } },
  });
  if (error) {
    return { error: "登録できませんでした。すでに登録済みのメールアドレスかもしれません", email, displayName };
  }
  if (!data.session) {
    return { message: "確認メールを送りました。メールのリンクを開いてから、ログインしてください", email };
  }
  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
