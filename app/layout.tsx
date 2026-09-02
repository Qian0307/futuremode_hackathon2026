import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "社交電量計 · Social Battery Meter",
  description: "像管理電池一樣管理你的社交能量：預測每場活動的消耗，提早避開 burnout。",
};

export const viewport: Viewport = {
  themeColor: "#22c98a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" className={inter.variable}>
      <body className="font-sans antialiased">
        <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col px-5 pb-10 pt-6">
          <header className="mb-6 flex items-center justify-between">
            <Link href="/" className="text-base font-semibold tracking-tight text-foreground">
              社交電量計
            </Link>
            <nav className="flex items-center gap-1 rounded-full bg-white/70 p-1 text-sm shadow-sm backdrop-blur">
              <Link href="/" className="rounded-full px-3 py-1.5 text-muted-foreground transition hover:bg-white hover:text-foreground">
                今天
              </Link>
              <Link href="/week" className="rounded-full px-3 py-1.5 text-muted-foreground transition hover:bg-white hover:text-foreground">
                一週
              </Link>
            </nav>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
