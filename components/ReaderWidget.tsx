"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Upload, RotateCcw, X, Loader, Maximize2, BookOpen, Folder, FolderPlus, FileText } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { colorMap, type Widget } from "@/lib/widgets";
import FlipCard from "@/components/ui/FlipCard";
import { PencilButton, LoadingState } from "@/components/ui/WidgetChrome";
import * as storage from "@/lib/storage";
import { isDemoMode } from "@/lib/demo";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type FileType = "pdf" | "epub";
// filename: legacy uuid upload served by /api/files; path: a file in the
// user's library folder served by /api/library.
type ReaderConfig = { filename?: string; path?: string; fileType: FileType; displayName: string };

function srcFor(config: ReaderConfig): string {
  return config.path
    ? `/api/library?op=file&path=${encodeURIComponent(config.path)}`
    : `/api/files/${config.filename}`;
}

// ── PDF Viewer ─────────────────────────────────────────────────────────────

function PdfViewer({
  src,
  page,
  onPageChange,
  fullscreen = false,
}: {
  src: string;
  page: number;
  onPageChange: (p: number) => void;
  fullscreen?: boolean;
}) {
  const [numPages, setNumPages] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [fitMode, setFitMode] = useState<"height" | "width">("height");

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => setSize({
      width: Math.floor(e.contentRect.width),
      height: Math.floor(e.contentRect.height),
    }));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Keyboard nav in fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") onPageChange(Math.min(numPages, page + 1));
      if (e.key === "ArrowLeft"  || e.key === "ArrowUp")   onPageChange(Math.max(1, page - 1));
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fullscreen, page, numPages, onPageChange]);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-auto cursor-pointer"
        onClick={() => setFitMode(m => m === "height" ? "width" : "height")}
        title={fitMode === "height" ? "Click for fit to width" : "Click for fit to height"}
      >
        <div className="min-h-full flex items-center justify-center">
          {size.width > 0 && size.height > 0 && (
            <Document
              file={src}
              onLoadSuccess={({ numPages }) => setNumPages(numPages)}
              loading={<Loader size={16} className="animate-spin opacity-40" />}
            >
              <Page
                pageNumber={page}
                height={fitMode === "height" ? size.height : undefined}
                width={fitMode === "width" ? size.width : undefined}
                renderAnnotationLayer={false}
                renderTextLayer={false}
              />
            </Document>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 shrink-0">
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="text-neutral-400 hover:text-neutral-700 disabled:opacity-20"
          >
            <ChevronLeft size={fullscreen ? 20 : 16} />
          </button>
          <span className={`text-neutral-500 tabular-nums ${fullscreen ? "text-sm" : "text-xs"}`}>
            {page} / {numPages || "…"}
          </span>
          <button
            onClick={() => onPageChange(Math.min(numPages, page + 1))}
            disabled={numPages > 0 && page >= numPages}
            className="text-neutral-400 hover:text-neutral-700 disabled:opacity-20"
          >
            <ChevronRight size={fullscreen ? 20 : 16} />
          </button>
        </div>
        {numPages > 0 && (
          <div className="w-full h-0.5 bg-neutral-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-neutral-400 rounded-full transition-all duration-300"
              style={{ width: `${(page / numPages) * 100}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── EPUB Viewer ────────────────────────────────────────────────────────────

function EpubViewer({
  src,
  cfi,
  onLocationChange,
  fullscreen = false,
}: {
  src: string;
  cfi: string;
  onLocationChange: (cfi: string) => void;
  fullscreen?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renditionRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bookRef = useRef<any>(null);
  const lastCfiRef = useRef<string>("");
  const dimsRef = useRef<{ w: number; h: number } | null>(null);
  const [dimsReady, setDimsReady] = useState(false);
  const [percentage, setPercentage] = useState<number | null>(null);

  const applyEpubTheme = useCallback(() => {
    if (!renditionRef.current || !wrapperRef.current) return;
    const widgetEl = wrapperRef.current.closest<HTMLElement>(".rounded-2xl");
    const bg = widgetEl
      ? getComputedStyle(widgetEl).backgroundColor
      : getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();
    const fg = getComputedStyle(document.documentElement).getPropertyValue("--text-primary").trim();
    renditionRef.current.themes.override("color", fg || "#404040");
    renditionRef.current.themes.override("background", bg || "#ffffff");
    if (wrapperRef.current) wrapperRef.current.style.background = bg || "";
  }, []);

  // Re-apply theme when dark mode toggles
  useEffect(() => {
    const observer = new MutationObserver(applyEpubTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [applyEpubTheme]);

  // Measure on every resize; call rendition.resize() directly — no state re-render needed
  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 0 && height > 0) {
        dimsRef.current = { w: Math.floor(width), h: Math.floor(height) };
        if (renditionRef.current) {
          renditionRef.current.resize(dimsRef.current.w, dimsRef.current.h);
        } else {
          // Dims became available for the first time — trigger init
          setDimsReady(true);
        }
      }
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  // Init / re-init when filename changes (dimsReady ensures dims are available)
  useEffect(() => {
    if (!dimsReady || !dimsRef.current || !viewerRef.current) return;
    let active = true;

    if (viewerRef.current) viewerRef.current.innerHTML = "";

    import("epubjs").then(({ default: Epub }) => {
      if (!active || !viewerRef.current || !dimsRef.current) return;

      const book = Epub(src);
      bookRef.current = book;
      const rendition = book.renderTo(viewerRef.current, {
        width: dimsRef.current.w,
        height: dimsRef.current.h,
        flow: "paginated",
      });
      renditionRef.current = rendition;
      rendition.hooks.content.register(() => applyEpubTheme());
      rendition.display(cfi || undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rendition.on("relocated", (location: any) => {
        lastCfiRef.current = location.start.cfi;
        onLocationChange(location.start.cfi);
        const pct = book.locations.percentageFromCfi?.(location.start.cfi);
        if (pct != null) setPercentage(Math.round(pct * 100));
      });

      // Generate locations for accurate percentage — cached in localStorage
      book.ready.then(() => {
        if (!active) return;
        const cacheKey = `epub-locs-v1-${src}`;
        const cached = localStorage.getItem(cacheKey);

        function refreshPct() {
          if (!active || !lastCfiRef.current) return;
          const pct = book.locations.percentageFromCfi(lastCfiRef.current);
          if (pct != null) setPercentage(Math.round(pct * 100));
        }

        if (cached) {
          book.locations.load(cached);
          refreshPct();
        } else {
          book.locations.generate(1600).then(() => {
            if (!active) return;
            try { localStorage.setItem(cacheKey, book.locations.save()); } catch {}
            refreshPct();
          });
        }
      });
    });

    return () => {
      active = false;
      renditionRef.current?.destroy();
      renditionRef.current = null;
      bookRef.current = null;
      lastCfiRef.current = "";
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, dimsReady, applyEpubTheme]);

  // Keyboard nav in fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") renditionRef.current?.next();
      if (e.key === "ArrowLeft"  || e.key === "ArrowUp")   renditionRef.current?.prev();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fullscreen]);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      {/* wrapperRef measures available space; viewerRef is the epubjs mount target */}
      <div ref={wrapperRef} className="flex-1 min-h-0 relative overflow-hidden rounded-xl">
        <div ref={viewerRef} className="absolute inset-0" />
      </div>
      <div className="flex flex-col gap-1.5 shrink-0">
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={e => { e.stopPropagation(); renditionRef.current?.prev(); }}
            className="text-neutral-400 hover:text-neutral-700"
          >
            <ChevronLeft size={fullscreen ? 20 : 16} />
          </button>
          <span className={`text-neutral-500 tabular-nums ${fullscreen ? "text-sm" : "text-xs"}`}>
            {percentage !== null ? `${percentage}%` : "…"}
          </span>
          <button
            onClick={e => { e.stopPropagation(); renditionRef.current?.next(); }}
            className="text-neutral-400 hover:text-neutral-700"
          >
            <ChevronRight size={fullscreen ? 20 : 16} />
          </button>
        </div>
        {percentage !== null && (
          <div className="w-full h-0.5 bg-neutral-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-neutral-400 rounded-full transition-all duration-300"
              style={{ width: `${percentage}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Fullscreen overlay ─────────────────────────────────────────────────────

function FullscreenOverlay({
  config,
  position,
  onPageChange,
  onClose,
}: {
  config: ReaderConfig;
  position: string;
  onPageChange: (pos: string) => void;
  onClose: () => void;
}) {
  // Close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative bg-[var(--surface)] rounded-2xl shadow-2xl flex flex-col"
        style={{ width: "min(90vw, 800px)", height: "min(92vh, 1000px)" }}
      >
        {/* Overlay header */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0 border-b border-[var(--surface-border)]">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)] truncate">{config.displayName}</p>
            <span className="text-xs text-[var(--text-secondary)] opacity-70 uppercase tracking-widest">{config.fileType}</span>
          </div>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] ml-4">
            <X size={18} />
          </button>
        </div>

        {/* Reader */}
        <div className="flex flex-1 min-h-0 p-4">
          {config.fileType === "pdf" ? (
            <PdfViewer
              src={srcFor(config)}
              page={parseInt(position) || 1}
              onPageChange={p => onPageChange(String(p))}
              fullscreen
            />
          ) : (
            <EpubViewer
              src={srcFor(config)}
              cfi={position}
              onLocationChange={onPageChange}
              fullscreen
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── ReaderWidget ───────────────────────────────────────────────────────────

export default function ReaderWidget({
  widget,
  className = "",
}: {
  widget: Widget;
  className?: string;
}) {
  const c = colorMap[widget.color] ?? colorMap["neutral"];
  const configKey = `reader-config-${widget.id}`;
  const positionKey = `reader-position-${widget.id}`;

  const [config, setConfig] = useState<ReaderConfig | null>(null);
  const [position, setPosition] = useState("1");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const libFileRef = useRef<HTMLInputElement>(null);

  // Library browser (settings face): the user's server-side folder of books.
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<{ dirs: string[]; files: { name: string; size: number }[] } | null>(null);
  const [libLoading, setLibLoading] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolder, setNewFolder] = useState("");

  async function loadDir(d: string) {
    setLibLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/library?op=list&path=${encodeURIComponent(d)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDir(d);
      setEntries(data);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLibLoading(false);
    }
  }

  async function makeFolder() {
    if (isDemoMode()) {
      setError("Folders are not available in demo mode.");
      return;
    }
    const name = newFolder.trim();
    if (!name) return;
    setError("");
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "mkdir", path: dir, name }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setNewFolder("");
      setNewFolderOpen(false);
      loadDir(dir);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }

  async function selectFile(name: string) {
    const ext = name.split(".").pop()?.toLowerCase() as FileType;
    const newConfig: ReaderConfig = {
      path: dir ? `${dir}/${name}` : name,
      fileType: ext,
      displayName: name.replace(/\.[^.]+$/, ""),
    };
    setConfig(newConfig);
    setPosition(ext === "pdf" ? "1" : "");
    await storage.setItem(configKey, JSON.stringify(newConfig));
    await storage.removeItem(positionKey);
    setSettingsOpen(false);
  }

  useEffect(() => {
    Promise.all([
      storage.getItem(configKey),
      storage.getItem(positionKey),
    ]).then(([savedConfig, savedPosition]) => {
      if (savedConfig) {
        try { setConfig(JSON.parse(savedConfig)); } catch {}
      }
      if (savedPosition) setPosition(savedPosition);
    });
  }, [configKey, positionKey]);

  async function handleFile(file: File) {
    // Uploads write real files to the server, which the demo sandbox can't
    // intercept or roll back.
    if (isDemoMode()) {
      setError("Uploads are not available in demo mode.");
      return;
    }
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf" && ext !== "epub") {
      setError("Only PDF and EPUB files are supported.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      // dir goes first so the server knows the target folder before the file
      // stream starts.
      const formData = new FormData();
      formData.append("dir", dir);
      formData.append("file", file);
      const res = await fetch("/api/library", { method: "POST", body: formData });
      if (!res.ok) throw new Error();
      const { name, path } = await res.json();
      const newConfig: ReaderConfig = {
        path,
        fileType: ext as FileType,
        displayName: name.replace(/\.[^.]+$/, ""),
      };
      setConfig(newConfig);
      setPosition(ext === "pdf" ? "1" : "");
      await storage.setItem(configKey, JSON.stringify(newConfig));
      await storage.removeItem(positionKey);
      setSettingsOpen(false);
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function savePosition(pos: string) {
    setPosition(pos);
    await storage.setItem(positionKey, pos);
  }

  async function handleReset() {
    await storage.removeItem(configKey);
    await storage.removeItem(positionKey);
    setConfig(null);
    setPosition("1");
    setSettingsOpen(false);
  }

  const uploadZone = (compact = false) => (
    <div
      className={`flex flex-col items-center justify-center gap-3 flex-1 min-h-0 ${compact ? "" : "border-2 border-dashed rounded-xl"} border-neutral-200`}
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      }}
    >
      {uploading ? (
        <LoadingState c={c} />
      ) : (
        <>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--surface-border-focus)]"
          >
            <Upload size={13} />
            {compact ? "Upload new file" : "Upload PDF or EPUB"}
          </button>
          {!compact && (
            <p className={`text-xs opacity-40 ${c.text}`}>or drag and drop</p>
          )}
        </>
      )}
      {error && <p className="text-red-400 text-xs text-center px-2">{error}</p>}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.epub"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );

  return (
    <>
      <FlipCard
        c={c}
        flipped={settingsOpen}
        className={className}
        front={
          <>
            <div className="flex items-center justify-between mb-3 shrink-0">
              <div className={`flex items-center gap-1.5 min-w-0 ${c.label}`}>
                <span className="opacity-50 shrink-0"><BookOpen size={14} /></span>
                {config && (
                  <span className="text-xs font-medium opacity-60 truncate">{config.displayName}</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                {config && (
                  <button
                    onClick={() => setFullscreen(true)}
                    className={`opacity-0 group-hover:opacity-90 dark:group-hover:opacity-70 [@media(hover:none)]:!opacity-90 dark:[@media(hover:none)]:!opacity-70 hover:!opacity-100 ${c.icon}`}
                    title="Open full view"
                  >
                    <Maximize2 size={14} />
                  </button>
                )}
                <PencilButton c={c} onClick={() => { setSettingsOpen(true); setError(""); loadDir(dir); }} title="Settings" />
              </div>
            </div>

            {config ? (
              fullscreen ? (
                <div className="flex-1 min-h-0 flex items-center justify-center">
                  <p className={`text-xs opacity-30 ${c.text}`}>reading in full view</p>
                </div>
              ) : (
                <div className="flex flex-col flex-1 min-h-0">
                  {config.fileType === "pdf" ? (
                    <PdfViewer
                      src={srcFor(config)}
                      page={parseInt(position) || 1}
                      onPageChange={p => savePosition(String(p))}
                    />
                  ) : (
                    <EpubViewer
                      src={srcFor(config)}
                      cfi={position}
                      onLocationChange={savePosition}
                    />
                  )}
                </div>
              )
            ) : (
              uploadZone()
            )}
          </>
        }
        back={
          <>
            <div className="flex flex-col gap-2 flex-1 min-h-0">
              {/* Current folder + actions */}
              <div className={`flex items-center gap-1.5 shrink-0 text-xs ${c.label}`}>
                {dir && (
                  <button
                    onClick={() => loadDir(dir.split("/").slice(0, -1).join("/"))}
                    className="opacity-60 hover:opacity-100 shrink-0"
                    title="Up one folder"
                  >
                    <ChevronLeft size={13} />
                  </button>
                )}
                <span className="flex-1 min-w-0 truncate opacity-60 font-medium">{dir || "Library"}</span>
                <button
                  onClick={() => setNewFolderOpen(o => !o)}
                  className="opacity-60 hover:opacity-100 shrink-0"
                  title="New folder"
                >
                  <FolderPlus size={13} />
                </button>
                <button
                  onClick={() => libFileRef.current?.click()}
                  className="opacity-60 hover:opacity-100 shrink-0"
                  title="Upload into this folder"
                >
                  {uploading ? <Loader size={13} className="animate-spin" /> : <Upload size={13} />}
                </button>
              </div>

              {newFolderOpen && (
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    autoFocus
                    value={newFolder}
                    onChange={e => setNewFolder(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && makeFolder()}
                    placeholder="folder name"
                    className={`flex-1 min-w-0 text-xs rounded-lg px-2 py-1 outline-none bg-black/5 dark:bg-white/10 ${c.text} placeholder:opacity-40`}
                  />
                  <button
                    onClick={makeFolder}
                    className="text-xs px-2 py-1 rounded-lg bg-white border border-neutral-200 text-neutral-600 hover:text-neutral-800 shrink-0"
                  >
                    Create
                  </button>
                </div>
              )}

              {/* Folder listing */}
              <div
                className="flex-1 min-h-0 overflow-y-auto pr-2"
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) handleFile(file);
                }}
              >
                {libLoading ? (
                  <LoadingState c={c} />
                ) : entries && (entries.dirs.length || entries.files.length) ? (
                  <ul className="flex flex-col">
                    {entries.dirs.map(d => (
                      <li key={`d-${d}`}>
                        <button
                          onClick={() => loadDir(dir ? `${dir}/${d}` : d)}
                          className={`w-full flex items-center gap-1.5 py-1.5 text-left text-xs ${c.text} hover:opacity-70 transition-opacity`}
                        >
                          <Folder size={12} className="shrink-0 opacity-40" />
                          <span className="flex-1 min-w-0 truncate font-medium">{d}</span>
                          <ChevronRight size={11} className="shrink-0 opacity-30" />
                        </button>
                      </li>
                    ))}
                    {entries.files.map(f => (
                      <li key={`f-${f.name}`}>
                        <button
                          onClick={() => selectFile(f.name)}
                          className={`w-full flex items-center gap-1.5 py-1.5 text-left text-xs ${c.text} hover:opacity-70 transition-opacity`}
                        >
                          <FileText size={12} className="shrink-0 opacity-40" />
                          <span className="flex-1 min-w-0 truncate">{f.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={`text-xs opacity-40 pt-2 ${c.text}`}>Empty folder. Upload a PDF or EPUB here, or drop one in.</p>
                )}
              </div>

              {error && <p className="text-red-400 text-xs shrink-0">{error}</p>}
            </div>

            <input
              ref={libFileRef}
              type="file"
              accept=".pdf,.epub"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />

            <div className="flex items-center justify-between mt-2 shrink-0">
              <button onClick={handleReset} className={`${c.label} opacity-40 hover:opacity-70`} title="Remove file">
                <RotateCcw size={13} />
              </button>
              <button
                onClick={() => { setSettingsOpen(false); setError(""); }}
                className="text-neutral-400 hover:text-neutral-600"
                title="Cancel"
              >
                <X size={14} />
              </button>
            </div>
          </>
        }
      />

      {fullscreen && config && (
        <FullscreenOverlay
          config={config}
          position={position}
          onPageChange={savePosition}
          onClose={() => setFullscreen(false)}
        />
      )}
    </>
  );
}
