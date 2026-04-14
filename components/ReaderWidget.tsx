"use client";

import { useState, useEffect, useRef } from "react";
import { Pencil, ChevronLeft, ChevronRight, Upload, RotateCcw, X, Loader } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

type FileType = "pdf" | "epub";
type ReaderConfig = { filename: string; fileType: FileType; displayName: string };

// ── PDF Viewer ─────────────────────────────────────────────────────────────

function PdfViewer({
  filename,
  page,
  onPageChange,
}: {
  filename: string;
  page: number;
  onPageChange: (p: number) => void;
}) {
  const [numPages, setNumPages] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden flex items-start justify-center">
        {width > 0 && (
          <Document
            file={`/api/files/${filename}`}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            loading={<Loader size={16} className="animate-spin opacity-40 mt-8" />}
          >
            <Page
              pageNumber={page}
              width={width}
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
          <ChevronLeft size={16} />
        </button>
        <span className="text-xs text-neutral-500 tabular-nums">
          {page} / {numPages || "…"}
        </span>
        <button
          onClick={() => onPageChange(Math.min(numPages, page + 1))}
          disabled={numPages > 0 && page >= numPages}
          className="text-neutral-400 hover:text-neutral-700 disabled:opacity-20"
        >
          <ChevronRight size={16} />
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
}: {
  filename: string;
  cfi: string;
  onLocationChange: (cfi: string) => void;
}) {
  const viewerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renditionRef = useRef<any>(null);

  useEffect(() => {
    if (!viewerRef.current) return;
    let active = true;

    import("epubjs").then(({ default: Epub }) => {
      if (!active || !viewerRef.current) return;

      const book = Epub(`/api/files/${filename}`);
      const rendition = book.renderTo(viewerRef.current, {
        width: "100%",
        height: "100%",
        flow: "paginated",
      });
      renditionRef.current = rendition;

      if (cfi) {
        rendition.display(cfi);
      } else {
        rendition.display();
      }

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
  // Only re-mount when the file changes, not on every cfi/callback change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename]);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <div ref={viewerRef} className="flex-1 min-h-0 overflow-hidden rounded-xl" />
      <div className="flex items-center justify-center gap-4 shrink-0">
        <button
          onClick={() => renditionRef.current?.prev()}
          className="text-neutral-400 hover:text-neutral-700"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={() => renditionRef.current?.next()}
          className="text-neutral-400 hover:text-neutral-700"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
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
      const initialPosition = ext === "pdf" ? "1" : "";
      setConfig(newConfig);
      setPosition(initialPosition);
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
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium border border-neutral-200 bg-white text-neutral-600 hover:text-neutral-900 hover:border-neutral-300`}
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
        {!settingsOpen && (
          <button
            onClick={() => { setSettingsOpen(true); setError(""); }}
            className={`opacity-0 group-hover:opacity-40 hover:!opacity-80 shrink-0 ml-2 ${c.label}`}
          >
            <Pencil size={12} />
          </button>
        )}
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
        config.fileType === "pdf" ? (
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
        )
      ) : (
        uploadZone()
      )}
    </div>
  );
}
