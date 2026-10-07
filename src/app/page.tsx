"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Home from "@/components/Home";

export default function Page() {
  const router = useRouter();

  useEffect(() => {
    try {
      const last = localStorage.getItem("opendot-lastRoute");
      if (last && last !== "/" && !last.startsWith("/login") && !last.startsWith("/settings")) {
        router.replace(last);
      }
    } catch { /* localStorage unavailable */ }
  }, [router]);

  return <Home />;
}
