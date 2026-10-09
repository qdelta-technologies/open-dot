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
  themeColor: "#f6f6f6",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "QDot",
  description: "QDot – your team's AI agents, working on their own",
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
    if (location.pathname.indexOf('/login') === 0) isDark = false;
    if (isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.dataset.theme = 'dark';
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.dataset.theme = 'light';
    }
  } catch (e) {}
})();`;

// Runs before the first paint so the sidebar and top bar are drawn in their saved state (no flash or jump).
const layoutScript = `(function(){try{var d=document.documentElement;if(localStorage.getItem('qdot-sidebar-desktop')==='closed')d.dataset.sidebar='closed';var p=location.pathname;if(p.indexOf('/login')===0||p.indexOf('/dots/')===0)d.dataset.nobar='1';}catch(e){}})();`;

const splashScript = `(function(){try{if(sessionStorage.getItem('qdot-splash-seen'))document.documentElement.dataset.splash='off';}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${jetbrainsMono.variable} h-full`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: splashScript }} />
        <script dangerouslySetInnerHTML={{ __html: layoutScript }} />
      </head>
      <body className="flex h-full overflow-hidden">
        <SplashIntro />
        <Suspense fallback={<div className="qdot-sidebar-ph" aria-hidden="true" />}>
          <Sidebar />
        </Suspense>
        <main className="flex min-w-0 flex-1 flex-col bg-card">
          <Suspense fallback={<div className="qdot-bar-ph" aria-hidden="true" />}>
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
