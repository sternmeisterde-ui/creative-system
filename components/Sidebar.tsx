"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard", icon: "◈" },
  { href: "/panel", label: "Приборная панель", icon: "📡" },
  { href: "/pbi", label: "Загрузка PBI", icon: "📊" },
  { href: "/mapping", label: "Маппинг объявлений", icon: "🗂" },
  { href: "/library", label: "Библиотека", icon: "📚" },
  { href: "/database", label: "База данных", icon: "🗄" },
  { href: "/builder", label: "Конструктор", icon: "⚡" },
  { href: "/scenarios", label: "Сценарии", icon: "✍️" },
  { href: "/briefs", label: "Брифы", icon: "📋" },
  { href: "/creatives", label: "Готовые крео", icon: "🎬" },
  { href: "/analyze", label: "Анализ крео", icon: "🔍" },
  { href: "/analytics", label: "Аналитика", icon: "📈" },
  { href: "/feedback", label: "Обратная связь", icon: "🔄" },
  { href: "/competitors", label: "Конкуренты", icon: "🔍" },
  { href: "/admin", label: "Правила & Скиллы", icon: "⚙️" },
];

export default function Sidebar() {
  const path = usePathname();

  return (
    <aside style={{
      width: 220,
      position: "fixed",
      top: 0,
      left: 0,
      bottom: 0,
      background: "rgba(255,255,255,0.02)",
      borderRight: "1px solid rgba(255,255,255,0.06)",
      display: "flex",
      flexDirection: "column",
      padding: "24px 12px",
      zIndex: 100,
    }}>
      <div style={{ padding: "0 8px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: 9, letterSpacing: 4, textTransform: "uppercase", color: "#E8AA42", fontWeight: 700, marginBottom: 4 }}>
          STERNMEISTER
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#E2E0DB" }}>Creative System</div>
      </div>

      <nav style={{ flex: 1, marginTop: 16, display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV.map(({ href, label, icon }) => {
          const active = path === href || (href !== "/" && path.startsWith(href));
          return (
            <Link key={href} href={href} style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 12px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: active ? 700 : 400,
              color: active ? "#E8AA42" : "#666",
              background: active ? "rgba(232,170,66,0.08)" : "transparent",
              border: active ? "1px solid rgba(232,170,66,0.12)" : "1px solid transparent",
              textDecoration: "none",
              transition: "all 0.15s",
            }}>
              <span style={{ fontSize: 14, width: 20, textAlign: "center" }}>{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      <div style={{ padding: "12px 8px 0", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: 10, color: "#333" }}>
        v0.1 — MVP
      </div>
    </aside>
  );
}
