"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  File,
  FileCode,
  FileText,
  FolderArchive,
  HardDrive,
  Image as ImageIcon,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  connectApp,
  deleteAllUploadedFiles,
  deleteUploadedFile,
  getStorageInfo,
  refreshApps,
  signInComposio,
} from "@/app/actions";
import { useStore } from "@/lib/store";
import { openAfter } from "@/lib/popup";
import type { StoredFile } from "@/server/files";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  const tb = bytes / 1024 ** 4;
  return `${Number.isInteger(tb) ? tb : tb.toFixed(1)} TB`;
}

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function fileIcon(mime: string) {
  if (mime.startsWith("image/")) return <ImageIcon className="size-4 text-sky-500" strokeWidth={1.75} />;
  if (mime === "application/pdf") return <FileText className="size-4 text-rose-500" strokeWidth={1.75} />;
  if (mime.includes("json") || mime.includes("javascript") || mime.includes("python") || mime.includes("typescript")) {
    return <FileCode className="size-4 text-amber-500" strokeWidth={1.75} />;
  }
  return <File className="size-4 text-foreground/50" strokeWidth={1.75} />;
}

export default function StorageManager() {
  const [data, setData] = useState<{
    stats: { totalFiles: number; totalBytes: number; railwayLimitBytes: number; percentUsed: number; diskUsedBytes: number | null; diskTotalBytes: number | null };
    googleDriveConnected: boolean;
    drive: { limit: number | null; usage: number; usageInDrive: number; usageInTrash: number } | null;
    driveError: string | null;
    files: StoredFile[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const signedIn = useStore((s) => s.computer.composio);

  const loadData = () => {
    setLoading(true);
    startTransition(async () => {
      try {
        const res = await getStorageInfo();
        setData(res);
      } catch (err) {
        console.error("Failed to load storage info:", err);
      } finally {
        setLoading(false);
      }
    });
  };

  useEffect(() => {
    loadData();
    const onFocus = () => {
      void refreshApps().then(() => loadData());
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const handleConnectGoogleDrive = () => {
    setConnectError(null);
    setConnecting(true);
    startTransition(() => {
      openAfter(
        signedIn ? () => connectApp("googledrive") : signInComposio,
        (err) => setConnectError(err)
      )
        .then(() => {
          void refreshApps().then(() => loadData());
        })
        .finally(() => {
          setConnecting(false);
        });
    });
  };

  const handleDelete = (id: string) => {
    setDeletingId(id);
    startTransition(async () => {
      try {
        await deleteUploadedFile(id);
        setData((prev) => {
          if (!prev) return prev;
          const remaining = prev.files.filter((f) => f.id !== id);
          const freed = prev.files.find((f) => f.id === id)?.size ?? 0;
          const newTotal = Math.max(0, prev.stats.totalBytes - freed);
          return {
            ...prev,
            files: remaining,
            stats: {
              ...prev.stats,
              totalFiles: remaining.length,
              totalBytes: newTotal,
              percentUsed: Math.min(100, Math.round((newTotal / prev.stats.railwayLimitBytes) * 100)),
            },
          };
        });
      } finally {
        setDeletingId(null);
      }
    });
  };

  const handleClearAll = () => {
    startTransition(async () => {
      try {
        await deleteAllUploadedFiles();
        setConfirmClear(false);
        loadData();
      } catch (err) {
        console.error("Failed to clear all files:", err);
      }
    });
  };

  const stats = data?.stats ?? { totalFiles: 0, totalBytes: 0, railwayLimitBytes: 500 * 1024 * 1024, percentUsed: 0, diskUsedBytes: null, diskTotalBytes: null };
  const googleDriveConnected = data?.googleDriveConnected ?? false;
  const files = data?.files ?? [];

  return (
    <div className="space-y-4">
      {/* Overview Cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Railway Storage Card */}
        <div className="surface rounded-2xl p-4 sm:p-5 border border-black/[0.08] dark:border-white/[0.08]">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <HardDrive className="size-4 text-brand" strokeWidth={1.75} />
              <span className="text-[13px] font-semibold text-foreground">Railway Disk</span>
            </div>
            <span className="font-mono text-[12px] font-medium text-foreground/60">
              {formatBytes(stats.diskUsedBytes ?? stats.totalBytes)} / {formatBytes(stats.railwayLimitBytes)} ({stats.percentUsed}%)
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08] mb-3">
            <div
              className={`h-full transition-all duration-500 rounded-full ${
                stats.percentUsed > 80 ? "bg-rose-500" : stats.percentUsed > 50 ? "bg-amber-500" : "bg-brand"
              }`}
              style={{ width: `${Math.max(stats.totalBytes > 0 ? 3 : 0, stats.percentUsed)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[12px] text-foreground/50">
            <span>{stats.totalFiles} attachment{stats.totalFiles === 1 ? "" : "s"} on the server · {formatBytes(stats.totalBytes)}</span>
            <span>
              {stats.percentUsed > 85 ? (
                <span className="text-rose-500 font-medium flex items-center gap-1">
                  <AlertTriangle className="size-3" /> Storage almost full
                </span>
              ) : (
                "Server disk (real usage)"
              )}
            </span>
          </div>
        </div>

        {/* Google Drive Cloud Card */}
        <div className="surface rounded-2xl p-4 sm:p-5 border border-black/[0.08] dark:border-white/[0.08]">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <FolderArchive className="size-4 text-emerald-500" strokeWidth={1.75} />
              <span className="text-[13px] font-semibold text-foreground">Google Drive Cloud Storage</span>
            </div>
            {googleDriveConnected ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 font-mono text-[12px] font-semibold text-emerald-500 uppercase">
                <CheckCircle2 className="size-3" /> Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 font-mono text-[12px] font-semibold text-amber-500 uppercase">
                Not Connected
              </span>
            )}
          </div>

          <p className="text-[12px] text-foreground/60 leading-relaxed mb-3">
            {googleDriveConnected
              ? "Google Drive is connected. Each attachment is copied to the “QDot Uploads” folder in your Drive. Server copies are removed after 7 days once they are safely backed up."
              : "Connect Google Drive to see your Drive storage here."}
          </p>

          {googleDriveConnected && data?.drive && (
            <div className="mb-3">
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
                <span className="font-mono font-medium text-foreground/75">
                  {formatBytes(data.drive.usage)} {data.drive.limit ? `of ${formatBytes(data.drive.limit)} used` : "used · unlimited"}
                </span>
                {data.drive.limit ? <span className="text-foreground/50">{Math.max(0.1, Math.round((data.drive.usage / data.drive.limit) * 1000) / 10)}%</span> : null}
              </div>
              {data.drive.limit ? (
                <div className="h-2 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
                  <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${Math.max(1.5, Math.min(100, (data.drive.usage / data.drive.limit) * 100))}%` }} />
                </div>
              ) : null}
              <p className="mt-1.5 text-[12px] text-foreground/55">
                {formatBytes(data.drive.usageInDrive)} in Drive files · {formatBytes(data.drive.usageInTrash)} in trash · the rest is Gmail and Photos
              </p>
            </div>
          )}
          {googleDriveConnected && !data?.drive && data && (
            <p className="mb-3 text-[12px] text-foreground/55" title={data.driveError ?? undefined}>
              {data.driveError ? "Couldn't read your Drive storage right now. Press Verify to try again." : "Reading your Drive storage…"}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[12px] text-foreground/50">Provider: Composio MCP</span>
            {!googleDriveConnected ? (
              <button
                type="button"
                onClick={handleConnectGoogleDrive}
                disabled={connecting || pending}
                className="btn-primary h-7 px-3 text-[12px] font-medium inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer shadow-xs"
              >
                {connecting ? (
                  <>
                    <RefreshCw className="size-3 animate-spin" />
                    Connecting…
                  </>
                ) : (
                  <>
                    Connect Google Drive
                    <ExternalLink className="size-3" />
                  </>
                )}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
                  Sync Enabled
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void refreshApps().then(() => loadData());
                  }}
                  className="text-[12px] text-foreground/45 hover:text-foreground underline decoration-dotted transition-colors"
                  title="Check connection status"
                >
                  Verify
                </button>
              </div>
            )}
          </div>

          {connectError && (
            <p className="mt-2 text-[12px] text-destructive leading-tight bg-destructive/10 p-2 rounded-md">
              {connectError}
            </p>
          )}
        </div>
      </div>

      {/* Smart Compression Notice */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-brand/20 bg-brand/[0.04] px-4 py-2.5 text-[12px]">
        <div className="flex items-center gap-2 text-foreground/80">
          <Sparkles className="size-3.5 text-brand shrink-0" strokeWidth={2} />
          <span>
            <strong>Smart Image Compression Active:</strong> Large images (e.g. 20 MB photos) are automatically resized and compressed to &lt;1.5 MB before upload.
          </span>
        </div>
        <button
          onClick={loadData}
          disabled={loading || pending}
          className="btn-quiet h-7 px-2 text-[12px] flex items-center gap-1"
          title="Refresh storage"
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* File List Header */}
      <div className="flex items-center justify-between pt-2">
        <h4 className="text-[14px] font-semibold text-foreground">
          Uploaded Files ({files.length})
        </h4>

        {files.length > 0 && (
          <div>
            {!confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="btn-quiet h-7.5 px-2.5 text-[12px] text-destructive hover:bg-destructive/10"
              >
                Clear all files
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-destructive font-medium">Delete all {files.length} files?</span>
                <button
                  type="button"
                  onClick={handleClearAll}
                  disabled={pending}
                  className="rounded-lg bg-destructive px-2 py-1 text-[12px] font-semibold text-white hover:opacity-90"
                >
                  Yes, delete all
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="btn-quiet h-6 px-2 text-[12px]"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* File List Table */}
      {files.length > 0 ? (
        <div className="surface divide-y divide-black/[0.06] dark:divide-white/[0.06] rounded-2xl border border-black/[0.08] dark:border-white/[0.08] overflow-hidden">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
              <div className="shrink-0">{fileIcon(f.mime)}</div>
              
              <div className="min-w-0 flex-1">
                <a
                  href={`/api/files/${f.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-[13px] font-medium text-foreground hover:text-brand hover:underline"
                  title={f.name}
                >
                  {f.name}
                </a>
                <div className="flex items-center gap-2 text-[12px] text-foreground/45">
                  <span>{formatDate(f.createdAt)}</span>
                  {f.dotName && (
                    <>
                      <span>•</span>
                      <span className="truncate max-w-32">{f.dotName}</span>
                    </>
                  )}
                  {f.driveFileId ? (
                    <>
                      <span>•</span>
                      <span className="text-emerald-600 dark:text-emerald-400">{f.localCopy ? "Backed up to Drive" : "In Drive only"}</span>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="shrink-0 text-right pr-2">
                <span className="font-mono text-[12px] text-foreground/60">{formatBytes(f.size)}</span>
              </div>

              <button
                type="button"
                onClick={() => handleDelete(f.id)}
                disabled={deletingId === f.id}
                aria-label={`Delete ${f.name}`}
                title="Delete file to free space"
                className="btn-quiet size-7.5 p-0 text-foreground/40 hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
              >
                {deletingId === f.id ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" strokeWidth={1.75} />
                )}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="surface rounded-2xl p-8 text-center border border-black/[0.08] dark:border-white/[0.08]">
          <FolderArchive className="size-8 mx-auto text-foreground/30 mb-2" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-foreground/70">No files currently taking up storage.</p>
          <p className="text-[12px] text-foreground/45 mt-1">
            Files attached in conversations or created by your dots will appear here for review and cleanup.
          </p>
        </div>
      )}
    </div>
  );
}
