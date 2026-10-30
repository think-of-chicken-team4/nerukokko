import type { Metadata, Viewport } from "next";

// フォントは npm のパッケージ（Fontsource）から読み込み、このアプリから配る。
// ビルドのたびに Google Fonts から取ってくると、取得に失敗して CI が落ちることがあったため（next/font/google はやめた）。
// 文字の範囲ごとにファイルが分かれているので、ブラウザは画面で使う文字の分だけ読み込む。
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/500.css";
import "@fontsource/noto-sans-jp/700.css";
import "@fontsource/zen-maru-gothic/500.css";
import "@fontsource/zen-maru-gothic/700.css";
import "@fontsource/zen-maru-gothic/900.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";

import "./globals.css";

export const metadata: Metadata = {
  title: "ねるコッコ",
  description: "にわとりと一緒に整える朝と夜。睡眠サポートデバイス「ねるコッコ」のアプリ",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#12142f",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
