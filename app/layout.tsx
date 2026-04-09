import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "SternMeister — Creative System",
  description: "AI-powered creative production system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ display: "flex", minHeight: "100vh", background: "#08090D" }}>
        <Sidebar />
        <main style={{ flex: 1, marginLeft: 220, padding: "32px 32px", minHeight: "100vh", overflowY: "auto" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
