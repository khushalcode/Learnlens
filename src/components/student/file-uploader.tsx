"use client";
// Reusable drag-and-drop file uploader.
// Used inside the submission form. Supports image / audio / video based on `accept`.

import { useCallback, useState, useRef } from "react";
import { Upload, X, FileText, ImageIcon, Music, Video } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FileUploaderProps {
  accept: string; // e.g. "image/jpeg,image/png"
  maxSizeMB?: number;
  onFileSelected: (file: File | null) => void;
  helperText?: string;
}

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  image: ImageIcon,
  audio: Music,
  video: Video,
  file: FileText,
};

function detectKind(accept: string): "image" | "audio" | "video" | "file" {
  if (accept.startsWith("image/")) return "image";
  if (accept.startsWith("audio/")) return "audio";
  if (accept.startsWith("video/")) return "video";
  return "file";
}

export function FileUploader({ accept, maxSizeMB = 50, onFileSelected, helperText }: FileUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const kind = detectKind(accept);
  const Icon = TYPE_ICON[kind];

  const handleFile = useCallback(
    (f: File | null) => {
      setError(null);
      if (!f) {
        setFile(null);
        setPreviewUrl(null);
        onFileSelected(null);
        return;
      }
      // Validate type
      const allowedTypes = accept.split(",").map((t) => t.trim());
      if (!allowedTypes.includes(f.type)) {
        setError(`Invalid file type. Allowed: ${allowedTypes.join(", ")}`);
        return;
      }
      // Validate size
      const sizeMB = f.size / (1024 * 1024);
      if (sizeMB > maxSizeMB) {
        setError(`File too large. Max ${maxSizeMB} MB.`);
        return;
      }
      setFile(f);
      setPreviewUrl(URL.createObjectURL(f));
      onFileSelected(f);
    },
    [accept, maxSizeMB, onFileSelected]
  );

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const f = e.dataTransfer.files?.[0] ?? null;
          handleFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
          isDragging
            ? "border-indigo-500 bg-indigo-50"
            : "border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/50"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
        {!file ? (
          <div className="flex flex-col items-center gap-2 text-slate-500">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
              <Upload className="h-5 w-5 text-indigo-600" />
            </div>
            <p className="text-sm font-medium">
              Click to browse or drag &amp; drop
            </p>
            <p className="text-xs text-slate-400">
              {helperText || `Max ${maxSizeMB} MB · ${accept}`}
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-left">
            {previewUrl && kind === "image" ? (
              <img src={previewUrl} alt="preview" className="w-16 h-16 object-cover rounded-md border border-slate-200" />
            ) : (
              <div className="w-16 h-16 rounded-md bg-indigo-100 flex items-center justify-center">
                <Icon className="h-7 w-7 text-indigo-600" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{file.name}</p>
              <p className="text-xs text-slate-500">
                {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type}
              </p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleFile(null);
              }}
              className="p-1.5 rounded-md hover:bg-rose-50 text-slate-400 hover:text-rose-600"
              aria-label="Remove file"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Live preview for audio/video */}
      {previewUrl && file && kind === "audio" && (
        <audio src={previewUrl} controls className="w-full" />
      )}
      {previewUrl && file && kind === "video" && (
        <video src={previewUrl} controls className="w-full max-h-80 rounded-md" />
      )}

      {error && (
        <p className="text-xs text-rose-600">{error}</p>
      )}
    </div>
  );
}
