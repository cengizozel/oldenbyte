"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Pencil, ChevronLeft, ChevronRight, Upload, RotateCcw, X, Loader, Maximize2 } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type FileType = "pdf" | "epub";
type ReaderConfig = { filename: string; fileType: FileType; displayName: string };

// ── PDF Viewer ─────────────────────────────────────────────────────────────

function PdfViewer({
  filename,
  page,
  onPageChange,
  fullscreen = false,
}: {
  filename: string;
  page: number;
  onPageChange: (p: number) => void;
  fullscreen?: boolean;
}) {
  const [numPages, setNumPages] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

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
      <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden flex items-center justify-center">
        {size.width > 0 && size.height > 0 && (
          <Document
            file={`/api/files/${filename}`}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            loading={<Loader size={16} className="animate-spin opacity-40" />}
          >
            <Page
              pageNumber={page}
              height={size.height}
              width={undefined}
              renderAnnotationLayer={false}
              renderTextLayer={false}
            />
          </Document>
        )}
      </div>
      <div className="flex items-center justify-center gap-4 shrink-0">
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
    </div>
  );
}

// ── EPUB Viewer ────────────────────────────────────────────────────────────

function EpubViewer({
  filename,
  cfi,
  onLocationChange,
  fullscreen = false,
}: {
  filename: string;
  cfi: string;
  onLocationChange: (cfi: string) => void;
  fullscreen?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renditionRef = useRef<any>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  // Measure wrapper once it has a real size
  useEffect(() => {
    if (!wrapperRef.current) return;
    let set = false;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 0 && height > 0 && !set) {
        set = true;
        setDims({ w: Math.floor(width), h: Math.floor(height) });
      }
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  // Init epubjs once pixel dimensions are known
  useEffect(() => {
    if (!dims || !viewerRef.current) return;
    let active = true;

    import("epubjs").then(({ default: Epub }) => {
      if (!active || !viewerRef.current) return;

      const book = Epub(`/api/files/${filename}`);
      const rendition = book.renderTo(viewerRef.current, {
        width: dims.w,
        height: dims.h,
        flow: "paginated",
      });
      renditionRef.current = rendition;
      rendition.display(cfi || undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rendition.on("relocated", (location: any) => {
        onLocationChange(location.start.cfi);
      });
    });

    return () => {
      active = false;
      renditionRef.current?.destroy();
      renditionRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename, dims]);

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
      <div className="flex items-center justify-center gap-4 shrink-0">
        <button
          onClick={e => { e.stopPropagation(); renditionRef.current?.prev(); }}
          className="text-neutral-400 hover:text-neutral-700"
        >
          <ChevronLeft size={fullscreen ? 20 : 16} />
        </button>
        <button
          onClick={e => { e.stopPropagation(); renditionRef.current?.next(); }}
          className="text-neutral-400 hover:text-neutral-700"
        >
          <ChevronRight size={fullscreen ? 20 : 16} />
        </button>
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
      <div className="relative bg-white rounded-2xl shadow-2xl flex flex-col"
        style={{ width: "min(90vw, 800px)", height: "min(92vh, 1000px)" }}
      >
        {/* Overlay header */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0 border-b border-neutral-100">
          <div>
            <p className="text-sm font-medium text-neutral-700 truncate">{config.displayName}</p>
            <span className="text-xs text-neutral-400 uppercase tracking-widest">{config.fileType}</span>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 ml-4">
            <X size={18} />
          </button>
        </div>

        {/* Reader */}
        <div className="flex flex-1 min-h-0 p-4">
          {config.fileType === "pdf" ? (
            <PdfViewer
              filename={config.filename}
              page={parseInt(position) || 1}
              onPageChange={p => onPageChange(String(p))}
              fullscreen
            />
          ) : (
            <EpubViewer
              filename={config.filename}
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
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf" && ext !== "epub") {
      setError("Only PDF and EPUB files are supported.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error();
      const { filename } = await res.json();
      const newConfig: ReaderConfig = {
        filename,
        fileType: ext as FileType,
        displayName: file.name.replace(/\.[^.]+$/, ""),
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
        <Loader size={18} className={`animate-spin opacity-40 ${c.label}`} />
      ) : (
        <>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium border border-neutral-200 bg-white text-neutral-600 hover:text-neutral-900 hover:border-neutral-300"
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
      <div className={`rounded-2xl border p-5 flex flex-col h-full relative group ${c.bg} ${c.border} ${className}`}>

        {/* Header */}
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div className="flex flex-col min-w-0">
            <p className={`text-xs font-semibold tracking-widest uppercase truncate ${c.label}`}>
              {config?.displayName ?? widget.title}
            </p>
            {config && (
              <span className={`text-xs opacity-40 uppercase tracking-widest ${c.label}`}>
                {config.fileType}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            {config && !settingsOpen && (
              <button
                onClick={() => setFullscreen(true)}
                className={`opacity-0 group-hover:opacity-40 hover:!opacity-80 ${c.label}`}
                title="Open full view"
              >
                <Maximize2 size={12} />
              </button>
            )}
            {!settingsOpen && (
              <button
                onClick={() => { setSettingsOpen(true); setError(""); }}
                className={`opacity-0 group-hover:opacity-40 hover:!opacity-80 ${c.label}`}
                title="Settings"
              >
                <Pencil size={12} />
              </button>
            )}
          </div>
        </div>

        {settingsOpen ? (
          <div className="flex flex-col gap-3 flex-1 min-h-0">
            {uploadZone(true)}
            <div className="flex items-center justify-between mt-auto">
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
          </div>
        ) : config ? (
          // In fullscreen mode, show a minimal placeholder in the widget
          fullscreen ? (
            <div className="flex-1 min-h-0 flex items-center justify-center">
              <p className={`text-xs opacity-30 ${c.text}`}>reading in full view</p>
            </div>
          ) : (
            <div
              className="flex flex-col flex-1 min-h-0 cursor-pointer"
              onClick={() => setFullscreen(true)}
              title="Click to open full view"
            >
              {config.fileType === "pdf" ? (
                <PdfViewer
                  filename={config.filename}
                  page={parseInt(position) || 1}
                  onPageChange={p => savePosition(String(p))}
                />
              ) : (
                <EpubViewer
                  filename={config.filename}
                  cfi={position}
                  onLocationChange={savePosition}
                />
              )}
            </div>
          )
        ) : (
          uploadZone()
        )}
      </div>

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
