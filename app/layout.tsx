import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "SternMeister — Creative System",
  description: "AI-powered creative production system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ display: "flex", minHeight: "100vh", background: "#08090D" }}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
