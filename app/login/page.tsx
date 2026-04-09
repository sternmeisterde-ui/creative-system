"use client";
import { useState, useEffect, useRef } from "react";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export default function LoginPage() {
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [greetingPhase, setGreetingPhase] = useState<"in" | "hold" | "out">("in");

  useEffect(() => {
    if (!greeting) return;
    const t1 = setTimeout(() => setGreetingPhase("hold"), 800);
    const t2 = setTimeout(() => setGreetingPhase("out"), 2800);
    const t3 = setTimeout(() => { window.location.href = "/"; }, 3800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [greeting]);

  async function handleLogin() {
    setError("");
    const email = emailRef.current?.value ?? "";
    const password = passwordRef.current?.value ?? "";
    if (!email || !password) { setError("Введите email и пароль"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json() as { access_token?: string; refresh_token?: string; user?: { user_metadata?: { greeting?: string } }; error_description?: string; msg?: string };
      if (!res.ok || !data.access_token) {
        setError(data.error_description ?? data.msg ?? "Неверный email или пароль");
        setLoading(false);
        return;
      }
      // Store tokens in cookies for proxy
      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
      document.cookie = `sb-access-token=${data.access_token}; path=/; expires=${expires}; SameSite=Lax`;
      if (data.refresh_token) {
        document.cookie = `sb-refresh-token=${data.refresh_token}; path=/; expires=${expires}; SameSite=Lax`;
      }
      const msg = data.user?.user_metadata?.greeting ?? "Добро пожаловать!";
      setGreeting(msg);
      setGreetingPhase("in");
    } catch {
      setError("Ошибка сети. Попробуйте снова.");
      setLoading(false);
    }
  }

  if (greeting) {
    const opacity = greetingPhase === "hold" ? 1 : 0;
    const scale = greetingPhase === "hold" ? 1 : greetingPhase === "in" ? 0.94 : 1.04;
    return (
      <div style={{ position: "fixed", inset: 0, background: "#08090D", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
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

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 6 }}>Email</label>
            <input ref={emailRef} type="email" autoComplete="email"
              style={{ width: "100%", padding: "10px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#E2E0DB", fontSize: 14, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 6 }}>Пароль</label>
            <input ref={passwordRef} type="password" autoComplete="current-password"
              onKeyDown={e => { if (e.key === "Enter") handleLogin(); }}
              style={{ width: "100%", padding: "10px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#E2E0DB", fontSize: 14, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          {error && <div style={{ fontSize: 12, color: "#e74c3c", textAlign: "center" }}>{error}</div>}
          <button onClick={handleLogin} disabled={loading}
            style={{ marginTop: 8, padding: "12px", background: loading ? "rgba(232,170,66,0.4)" : "#E8AA42", border: "none", borderRadius: 8, color: "#08090D", fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "Входим..." : "Войти"}
          </button>
        </div>
      </div>
    </div>
  );
}
