"use client";
import React from "react";

// ── Card ──────────────────────────────────────────────────────────────────────

export function Card({ children, style, onClick }: { children: React.ReactNode; style?: React.CSSProperties; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{
      background: "rgba(255,255,255,0.025)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 14,
      padding: "20px 22px",
      ...style,
    }}>
      {children}
    </div>
  );
}

// ── PageHeader ────────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, action }: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#E2E0DB", letterSpacing: -0.5 }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 13, color: "#555", marginTop: 4 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────

type BtnVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  style,
  size = "md",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  disabled?: boolean;
  style?: React.CSSProperties;
  size?: "sm" | "md" | "lg";
}) {
  const variants: Record<BtnVariant, React.CSSProperties> = {
    primary: { background: "rgba(232,170,66,0.15)", border: "1px solid rgba(232,170,66,0.3)", color: "#E8AA42" },
    secondary: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#AAA" },
    danger: { background: "rgba(217,107,107,0.1)", border: "1px solid rgba(217,107,107,0.25)", color: "#D96B6B" },
    ghost: { background: "transparent", border: "1px solid transparent", color: "#666" },
  };
  const sizes = { sm: { fontSize: 11, padding: "5px 12px" }, md: { fontSize: 12, padding: "8px 16px" }, lg: { fontSize: 13, padding: "11px 22px" } };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        borderRadius: 8,
        fontFamily: "inherit",
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "all 0.15s",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        whiteSpace: "nowrap",
        ...variants[variant],
        ...sizes[size],
        ...style,
      }}
    >
      {children}
    </button>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────

export function Badge({ children, color = "#E8AA42" }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "3px 9px",
      borderRadius: 6,
      fontSize: 10,
      fontWeight: 700,
      background: `${color}18`,
      border: `1px solid ${color}30`,
      color,
    }}>
      {children}
    </span>
  );
}

// ── Label ─────────────────────────────────────────────────────────────────────

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
      {children}
    </label>
  );
}

// ── SectionTitle ──────────────────────────────────────────────────────────────

export function SectionTitle({ color = "#E8AA42", icon, children }: {
  color?: string;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
      {icon && <span style={{ fontSize: 16 }}>{icon}</span>}
      <span style={{ fontSize: 13, fontWeight: 800, color, textTransform: "uppercase", letterSpacing: 0.5 }}>{children}</span>
    </div>
  );
}

// ── Empty ─────────────────────────────────────────────────────────────────────

export function Empty({ icon = "📭", text }: { icon?: string; text: string | React.ReactNode }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 20px", color: "#444" }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 13 }}>{text}</div>
    </div>
  );
}

// ── ColorDot ──────────────────────────────────────────────────────────────────

export function ColorDot({ color }: { color: string }) {
  return <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function Modal({ open, onClose, title, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: "#10111A", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: "28px 28px", maxWidth: 560, width: "100%", maxHeight: "85vh", overflowY: "auto" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#E8AA42" }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Stat ──────────────────────────────────────────────────────────────────────

export function Stat({ label, value, color = "#E8AA42" }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{label}</div>
    </div>
  );
}
