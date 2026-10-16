import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP, Space_Grotesk, Zen_Maru_Gothic } from "next/font/google";

import "./globals.css";

const notoSansJp = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
});

const zenMaru = Zen_Maru_Gothic({
  variable: "--font-zen-maru",
  weight: ["500", "700", "900"],
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  weight: ["500", "700"],
  subsets: ["latin"],
  display: "swap",
});

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
    <html lang="ja" className={`${notoSansJp.variable} ${zenMaru.variable} ${spaceGrotesk.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
