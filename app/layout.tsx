import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

const SITE_URL = "https://social-battery-meter.pages.dev";
const DESCRIPTION =
  "像管理電池一樣管理你的社交能量：AI 預測每場社交活動的消耗，" +
  "並把前一天沒補回來的赤字帶到隔天，讓你在 burnout 發生之前就看見它。";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "社交電量計 · Social Battery Meter",
  description: DESCRIPTION,
  applicationName: "社交電量計",
  // 圖示放 public/ 而不是 app/：App Router 會把 app/icon.svg 當成一條 route，
  // 而 next-on-pages 要求所有 route 都是 edge runtime，會直接讓建置失敗。
  icons: { icon: "/icon.svg", shortcut: "/icon.svg", apple: "/icon.svg" },
  openGraph: {
    type: "website",
    locale: "zh_TW",
    url: SITE_URL,
    siteName: "社交電量計",
    title: "社交電量計 · Social Battery Meter",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: "社交電量計 · Social Battery Meter",
    description: DESCRIPTION,
  },
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
            <nav className="flex items-center gap-0.5 rounded-full bg-white/70 p-1 text-xs shadow-sm backdrop-blur sm:text-sm">
              {[
                { href: "/", label: "今天" },
                { href: "/week", label: "一週" },
                { href: "/plan", label: "排程" },
                { href: "/review", label: "回顧" },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-full px-2.5 py-1.5 text-muted-foreground transition hover:bg-white hover:text-foreground sm:px-3"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
