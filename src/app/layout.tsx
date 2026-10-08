import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import Sidebar from "@/components/Sidebar";
import Toasts from "@/components/Toasts";
import VoicePanel from "@/components/VoicePanel";
import MobileBar from "@/components/MobileBar";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import SplashIntro from "@/components/SplashIntro";
import "./globals.css";

// Same pairing as the Composio landing site: Geist Sans (local variable font) + JetBrains Mono.
const geistSans = localFont({ src: "../fonts/Geist-Variable.woff2", weight: "100 900", variable: "--font-geist-sans" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0f14" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "QDot",
  description: "Open-source personal AI agents that work on their own, on their own computers",
  applicationName: "QDot",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "QDot",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/icons/apple-touch-icon.png",
  },
};

const themeScript = `(function() {
  try {
    var stored = localStorage.getItem('qdot-theme');
    var isDark = stored === 'dark' || ((!stored || stored === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.dataset.theme = 'dark';
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.dataset.theme = 'light';
    }
  } catch (e) {}
})();`;

const splashScript = `(function(){try{if(sessionStorage.getItem('qdot-splash-seen'))document.documentElement.dataset.splash='off';}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${jetbrainsMono.variable} h-full`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: splashScript }} />
      </head>
      <body className="flex h-full overflow-hidden">
        <SplashIntro />
        <Suspense>
          <Sidebar />
        </Suspense>
        <main className="flex min-w-0 flex-1 flex-col bg-card">
          <Suspense>
            <MobileBar />
          </Suspense>
          {children}
        </main>
        <Toasts />
        <VoicePanel />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
