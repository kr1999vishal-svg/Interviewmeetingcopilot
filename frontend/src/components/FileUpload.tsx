import { useRef, useState } from 'react';
import {
  UploadCloud,
  FileText,
  File as FileIcon,
  FileType2,
  Presentation,
  X,
  Eye,
  AlertCircle,
  Loader2,
  Download,
  CheckCircle2,
  FileWarning,
} from 'lucide-react';
import { createId, formatFileSize } from '@/lib/format';
import type { Attachment } from '@/types';

/** Maximum size per file. Kept conservative because files live in localStorage. */
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/** Allowed types keyed by extension, with matching MIME types. */
const ALLOWED_TYPES: Record<string, { label: string; mimes: string[] }> = {
  pdf: { label: 'PDF', mimes: ['application/pdf'] },
  docx: {
    label: 'DOCX',
    mimes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
  },
  txt: { label: 'TXT', mimes: ['text/plain'] },
  pptx: {
    label: 'PPTX',
    mimes: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
  },
};

const ACCEPT = '.pdf,.docx,.txt,.pptx';

type UploadPhase = 'reading' | 'extracting';

interface UploadingFile {
  id: string;
  name: string;
  size: number;
  progress: number;
  phase: UploadPhase;
}

interface FileUploadProps {
  attachments: Attachment[];
  onAdd: (attachment: Attachment) => void;
  onRemove: (id: string) => void;
}

const extensionOf = (name: string): string =>
  name.split('.').pop()?.toLowerCase() ?? '';

function iconForExtension(ext: string) {
  switch (ext) {
    case 'pdf':
      return FileType2;
    case 'txt':
      return FileText;
    case 'pptx':
      return Presentation;
    case 'docx':
      return FileText;
    default:
      return FileIcon;
  }
}

/** Validate a single file. Returns an error message, or null if valid. */
function validate(file: File): string | null {
  const ext = extensionOf(file.name);
  const rule = ALLOWED_TYPES[ext];
  if (!rule) {
    return `Unsupported type ".${ext}". Allowed: PDF, DOCX, TXT, PPTX.`;
  }
  // Browsers occasionally report an empty MIME; fall back to the extension.
  if (file.type && !rule.mimes.includes(file.type)) {
    return `File content does not match a ${rule.label} file.`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `Too large (${formatFileSize(file.size)}). Max ${formatFileSize(
      MAX_FILE_SIZE,
    )}.`;
  }
  if (file.size === 0) {
    return 'File is empty.';
  }
  return null;
}

export default function FileUpload({
  attachments,
  onAdd,
  onRemove,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<Attachment | null>(null);

  const patchUploading = (id: string, patch: Partial<UploadingFile>) =>
    setUploading((list) =>
      list.map((u) => (u.id === id ? { ...u, ...patch } : u)),
    );

  const removeUploading = (id: string) =>
    setUploading((list) => list.filter((u) => u.id !== id));

  /** Read the file to a base64 data URL with real progress reporting. */
  const readDataUrl = (file: File, uploadId: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (event) => {
        if (event.lengthComputable) {
          patchUploading(uploadId, {
            progress: Math.round((event.loaded / event.total) * 100),
          });
        }
      };
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}.`));
      reader.readAsDataURL(file);
    });

  const processFile = async (file: File) => {
    const uploadId = createId();
    setUploading((list) => [
      ...list,
      {
        id: uploadId,
        name: file.name,
        size: file.size,
        progress: 0,
        phase: 'reading',
      },
    ]);

    try {
      const dataUrl = await readDataUrl(file, uploadId);

      // Phase 2: extract plain text from the document.
      patchUploading(uploadId, { phase: 'extracting', progress: 100 });
      let extractedText = '';
      let extractionStatus: Attachment['extractionStatus'] = 'done';
      let extractionError: string | undefined;
      try {
        // Lazy-load the parser libs (pdf.js/mammoth/jszip) only on first use.
        const { extractText } = await import('@/lib/extractText');
        const result = await extractText(file);
        extractedText = result.truncated
          ? `${result.text}\n\n[Truncated — document is longer than the stored limit.]`
          : result.text;
        if (!extractedText.trim()) extractionStatus = 'empty';
      } catch (err) {
        extractionStatus = 'error';
        extractionError =
          err instanceof Error ? err.message : 'Text extraction failed.';
      }

      const attachment: Attachment = {
        id: createId(),
        name: file.name,
        size: file.size,
        extension: extensionOf(file.name),
        mimeType:
          file.type || ALLOWED_TYPES[extensionOf(file.name)]?.mimes[0] || '',
        dataUrl,
        uploadedAt: Date.now(),
        extractedText,
        extractionStatus,
        extractionError,
      };
      onAdd(attachment);
    } catch (err) {
      setErrors((e) => [
        ...e,
        err instanceof Error ? err.message : `Could not process ${file.name}.`,
      ]);
    } finally {
      setTimeout(() => removeUploading(uploadId), 400);
    }
  };

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setErrors([]);
    const nextErrors: string[] = [];

    Array.from(fileList).forEach((file) => {
      const error = validate(file);
      if (error) {
        nextErrors.push(`${file.name}: ${error}`);
        return;
      }
      const duplicate = attachments.some(
        (a) => a.name === file.name && a.size === file.size,
      );
      if (duplicate) {
        nextErrors.push(`${file.name}: already uploaded.`);
        return;
      }
      void processFile(file);
    });

    if (nextErrors.length) setErrors(nextErrors);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  // Open / download the original binary file in a new tab.
  const openOriginal = (attachment: Attachment) => {
    const link = document.createElement('a');
    link.href = attachment.dataUrl;
    link.target = '_blank';
    link.rel = 'noreferrer';
    if (
      attachment.mimeType !== 'text/plain' &&
      attachment.mimeType !== 'application/pdf'
    ) {
      link.download = attachment.name;
    }
    link.click();
  };

  return (
    <div className="card mb-6 p-5">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">
        Documents
        <span className="ml-2 font-normal text-slate-500">
          PDF, DOCX, TXT, PPTX up to {formatFileSize(MAX_FILE_SIZE)}
        </span>
      </h3>

      {/* Dropzone */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition ${
          dragging
            ? 'border-brand-500 bg-brand-600/10'
            : 'border-surface-border hover:border-brand-600 hover:bg-surface-muted/50'
        }`}
      >
        <UploadCloud className="mb-2 h-8 w-8 text-brand-300" />
        <p className="text-sm text-slate-200">
          <span className="font-semibold text-brand-300">Click to upload</span> or
          drag and drop
        </p>
        <p className="mt-1 text-xs text-slate-500">Multiple files supported</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {/* Validation errors */}
      {errors.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {errors.map((err, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}

      {/* In-progress uploads */}
      {uploading.length > 0 && (
        <div className="mt-3 space-y-2">
          {uploading.map((u) => (
            <div key={u.id} className="rounded-lg bg-surface-muted px-3 py-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2 truncate text-slate-200">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-300" />
                  <span className="truncate">{u.name}</span>
                </span>
                <span className="shrink-0 text-slate-400">
                  {u.phase === 'extracting' ? 'Extracting text…' : `${u.progress}%`}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-border">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all"
                  style={{ width: `${u.progress}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Uploaded files */}
      {attachments.length > 0 && (
        <ul className="mt-4 space-y-2">
          {attachments.map((a) => {
            const Icon = iconForExtension(a.extension);
            return (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-surface-border bg-surface-muted/50 px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600/15 text-brand-300">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-100">{a.name}</p>
                    <p className="flex items-center gap-2 text-xs text-slate-500">
                      <span>
                        {a.extension.toUpperCase()} · {formatFileSize(a.size)}
                      </span>
                      <ExtractionChip attachment={a} />
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    title="Preview extracted text"
                    onClick={() => setPreview(a)}
                    className="btn-ghost px-2 py-1"
                    disabled={!a.extractedText}
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="Open original file"
                    onClick={() => openOriginal(a)}
                    className="btn-ghost px-2 py-1"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="Remove"
                    onClick={() => onRemove(a.id)}
                    className="btn-ghost px-2 py-1 text-red-300 hover:bg-red-500/10"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {preview && (
        <TextPreviewModal
          attachment={preview}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function ExtractionChip({ attachment }: { attachment: Attachment }) {
  const status = attachment.extractionStatus;
  if (status === 'done') {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-400">
        <CheckCircle2 className="h-3 w-3" /> Text extracted
      </span>
    );
  }
  if (status === 'empty') {
    return (
      <span className="inline-flex items-center gap-1 text-slate-400">
        <FileWarning className="h-3 w-3" /> No text found
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span
        className="inline-flex items-center gap-1 text-amber-400"
        title={attachment.extractionError}
      >
        <AlertCircle className="h-3 w-3" /> Extraction failed
      </span>
    );
  }
  return null;
}

function TextPreviewModal({
  attachment,
  onClose,
}: {
  attachment: Attachment;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="card flex max-h-[80vh] w-full max-w-2xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-surface-border px-5 py-3">
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold text-white">
              {attachment.name}
            </h4>
            <p className="text-xs text-slate-500">Extracted text preview</p>
          </div>
          <button onClick={onClose} className="btn-ghost px-2 py-1">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          {attachment.extractedText ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-200">
              {attachment.extractedText}
            </pre>
          ) : (
            <p className="text-sm text-slate-500">
              No extracted text is available for this file.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
