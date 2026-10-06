"use client";

/**
 * Open a tab synchronously inside the click (so popup blockers allow it), then point it at a URL
 * that a server action returns. Closes the tab if there's nothing to open.
 */
export function openAfter(fetchUrl: () => Promise<{ url?: string; error?: string }>, onError: (e: string) => void): Promise<void> {
  const tab = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
  return fetchUrl()
    .then((r) => {
      if (r.error) {
        tab?.close();
        onError(r.error);
      } else if (r.url) {
        if (tab && !tab.closed) {
          tab.location.href = r.url;
        } else {
          // Mobile browser or popup blocker prevented new tab, navigate directly in current window
          window.location.href = r.url;
        }
      } else {
        tab?.close();
      }
    })
    .catch((err) => {
      tab?.close();
      onError(err instanceof Error ? err.message : String(err));
    });
}
