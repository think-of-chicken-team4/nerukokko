"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// match：そのタブを選択中として光らせるパス（デバイスシミュレーター /dev は設定から開くので設定タブ）
const TABS = [
  { href: "/", icon: "🏠", label: "ホーム", match: [] },
  { href: "/records", icon: "📊", label: "記録", match: ["/records"] },
  { href: "/device", icon: "🐔", label: "デバイス", match: ["/device"] },
  { href: "/settings", icon: "⚙️", label: "設定", match: ["/settings", "/dev"] },
] as const;

function isActive(pathname: string, tab: (typeof TABS)[number]) {
  if (tab.href === "/") return pathname === "/";
  return tab.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// 画面下部の4タブ
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="メインメニュー"
      className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-[430px] border-t border-black/5 bg-white/85 pb-[max(16px,env(safe-area-inset-bottom))] backdrop-blur-md"
    >
      {TABS.map((tab) => {
        const active = isActive(pathname, tab);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-[66px] flex-1 flex-col items-center gap-0.5 pt-3 text-[10.5px] ${
              active ? "font-bold text-gold-text" : "text-[#8b8478]"
            }`}
          >
            <span className="text-xl" aria-hidden>
              {tab.icon}
            </span>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
