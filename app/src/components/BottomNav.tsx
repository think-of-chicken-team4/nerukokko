"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", icon: "🏠", label: "ホーム" },
  { href: "/records", icon: "📊", label: "記録" },
  { href: "/device", icon: "🐔", label: "デバイス" },
  { href: "/settings", icon: "⚙️", label: "設定" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

// 画面下部の4タブ
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex h-[82px] max-w-[430px] border-t border-black/5 bg-white/85 pb-4 backdrop-blur-md">
      {TABS.map((tab) => {
        const active = isActive(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 pt-3 text-[10.5px] ${
              active ? "text-gold-text" : "text-[#8b8478]"
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
