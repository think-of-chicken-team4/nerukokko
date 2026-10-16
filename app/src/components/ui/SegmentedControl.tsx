import Link from "next/link";

type Item = { href: string; label: string };

// 表示の切り替え（例：記録の「今夜／週間」）。URL で切り替えるので、サーバーで描画するページでも使える
export function SegmentedControl({ items, current }: { items: readonly Item[]; current: string }) {
  return (
    <nav className="seg-ctrl">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          replace
          scroll={false}
          aria-current={item.href === current ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
