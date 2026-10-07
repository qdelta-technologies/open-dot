"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, PanelLeftOpen, SquarePen } from "lucide-react";
import {
  setDesktopSidebarOpen,
  setSidebarOpen,
  useDesktopSidebarOpen,
} from "@/lib/ui";
import { Wordmark } from "./Sidebar";

/** Opens the sidebar drawer on small screens or expands desktop sidebar when collapsed. */
export function MenuButton() {
  const desktopOpen = useDesktopSidebarOpen();
  return (
    <button
      className={`btn-quiet size-9 shrink-0 p-0 ${desktopOpen ? "md:hidden" : "flex"}`}
      onClick={() => {
        if (typeof window !== "undefined" && window.innerWidth < 768) {
          setSidebarOpen(true);
        } else {
          setDesktopSidebarOpen(true);
        }
      }}
      aria-label="Open sidebar"
      title="Open sidebar (Ctrl+B)"
    >
      <Menu className="size-5 md:hidden" strokeWidth={1.75} />
      <PanelLeftOpen className="hidden md:block size-4.5" strokeWidth={1.75} />
    </button>
  );
}

/** Top bar for small screens or when desktop sidebar is collapsed on pages without their own header (dot pages have one). */
export default function MobileBar() {
  const pathname = usePathname();
  const desktopOpen = useDesktopSidebarOpen();
  if (pathname === "/login" || pathname.startsWith("/dots/")) return null;

  return (
    <div
      className={`flex h-12 shrink-0 items-center gap-2 border-b border-black/[0.06] px-2 ${
        desktopOpen ? "md:hidden" : "flex"
      }`}
    >
      <MenuButton />
      <Link href="/" className="mr-auto">
        <Wordmark />
      </Link>
      <Link href="/" className="btn-quiet size-9 p-0" aria-label="New chat"
        onClick={() => { try { localStorage.removeItem("opendot-lastRoute"); } catch {} }}>
        <SquarePen className="size-4" strokeWidth={1.75} />
      </Link>
    </div>
  );
}
