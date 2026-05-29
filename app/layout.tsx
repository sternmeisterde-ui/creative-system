import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { brief } from "@/brief.config";

export const metadata: Metadata = {
  title: `${brief.business.name} — Creative System`,
  description: "AI-powered creative production system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={brief.business.language}>
      <body style={{ display: "flex", minHeight: "100vh", background: "#08090D" }}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
