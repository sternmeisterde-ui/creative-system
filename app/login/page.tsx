"use client";
import { useState, useEffect } from "react";

export default function LoginPage() {
  const [greeting, setGreeting] = useState("");
  const [greetingPhase, setGreetingPhase] = useState<"in" | "hold" | "out">("in");
  const [error, setError] = useState("");

  useEffect(() => {
    // Check for greeting cookie set by API route after login
    const match = document.cookie.match(/sb-greeting=([^;]+)/);
    if (match) {
      setGreeting(decodeURIComponent(match[1]));
      // Clear it
      document.cookie = "sb-greeting=; path=/; max-age=0";
    }
    // Check for error cookie
    const errMatch = document.cookie.match(/sb-login-error=([^;]+)/);
    if (errMatch) {
      setError(decodeURIComponent(errMatch[1]));
      document.cookie = "sb-login-error=; path=/; max-age=0";
    }
  }, []);

  useEffect(() => {
    if (!greeting) return;
    const t1 = setTimeout(() => setGreetingPhase("hold"), 800);
    const t2 = setTimeout(() => setGreetingPhase("out"), 2800);
    const t3 = setTimeout(() => { window.location.href = "/"; }, 3800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [greeting]);

  if (greeting) {
    const opacity = greetingPhase === "hold" ? 1 : 0;
    const scale = greetingPhase === "hold" ? 1 : greetingPhase === "in" ? 0.94 : 1.04;
    return (
      <div style={{ position: "fixed", inset: 0, background: "#08090D", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
        <div style={{ opacity, transform: `scale(${scale})`, transition: "opacity 0.9s cubic-bezier(0.4,0,0.2,1), transform 0.9s cubic-bezier(0.4,0,0.2,1)", textAlign: "center", userSelect: "none" }}>
          <div style={{ fontSize: 11, letterSpacing: 5, textTransform: "uppercase", color: "#E8AA42", fontWeight: 600, marginBottom: 20, opacity: 0.7 }}>STERNMEISTER</div>
          <div style={{ fontSize: 42, fontWeight: 700, color: "#E2E0DB", letterSpacing: -0.5, lineHeight: 1.15 }}>{greeting}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", width: "100vw", background: "#08090D" }}>
      <div style={{ width: 380, padding: "40px 36px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }}>
        <div style={{ marginBottom: 32, textAlign: "center" }}>
          <div style={{ fontSize: 9, letterSpacing: 4, textTransform: "uppercase", color: "#E8AA42", fontWeight: 700, marginBottom: 6 }}>STERNMEISTER</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#E2E0DB" }}>Creative System</div>
        </div>
        <form method="POST" action="/api/auth/login" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 6 }}>Email</label>
            <input name="email" type="email" autoComplete="email"
              style={{ width: "100%", padding: "10px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#E2E0DB", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 6 }}>Пароль</label>
            <input name="password" type="password" autoComplete="current-password"
              style={{ width: "100%", padding: "10px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#E2E0DB", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          {error && <div style={{ fontSize: 12, color: "#e74c3c", textAlign: "center" }}>{error}</div>}
          <button type="submit"
            style={{ marginTop: 8, padding: "12px", background: "#E8AA42", border: "none", borderRadius: 8, color: "#08090D", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Войти
          </button>
        </form>
      </div>
    </div>
  );
}
