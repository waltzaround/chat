import { useState } from "react";
import { Download, FileText, File as FileIcon, Music, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { formatBytes } from "@/lib/format";
import type { Attachment } from "@shared/types";

export function AttachmentView({ attachment }: { attachment: Attachment }) {
  const { mimeType, url, filename } = attachment;
  const [open, setOpen] = useState(false);

  if (mimeType.startsWith("image/")) {
    const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : 16 / 9;
    const maxW = 400;
    const maxH = 300;
    let w = Math.min(maxW, attachment.width ?? maxW);
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className="block overflow-hidden rounded-md border bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" style={{ width: w, height: h }} aria-label={`Open image ${filename}`}>
          <img src={url} alt={filename} loading="lazy" className="size-full object-cover" width={Math.round(w)} height={Math.round(h)} />
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-[min(96vw,1200px)] border-0 bg-transparent p-0 shadow-none [&>button]:hidden" aria-describedby={undefined}>
            <DialogTitle className="sr-only">{filename}</DialogTitle>
            <div className="relative">
              <img src={url} alt={filename} className="mx-auto max-h-[88vh] w-auto rounded-md object-contain" />
              <div className="mt-2 flex items-center justify-between text-xs text-white/80">
                <span className="truncate">
                  {filename} · {formatBytes(attachment.byteSize)}
                </span>
                <span className="flex gap-3">
                  <a href={url} download={filename} className="hover:text-white">
                    Download
                  </a>
                  <button type="button" onClick={() => setOpen(false)} className="hover:text-white" aria-label="Close">
                    <X className="size-4" />
                  </button>
                </span>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  if (mimeType.startsWith("video/")) {
    return <video src={url} controls preload="metadata" className="max-h-[300px] max-w-[400px] rounded-md border bg-black" aria-label={filename} />;
  }

  if (mimeType.startsWith("audio/")) {
    return (
      <div className="flex w-[360px] max-w-full flex-col gap-1 rounded-md border bg-muted/30 p-2">
        <div className="flex items-center gap-2 text-xs">
          <Music className="size-4 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{filename}</span>
          <span className="text-muted-foreground">{formatBytes(attachment.byteSize)}</span>
        </div>
        <audio src={url} controls preload="metadata" className="h-8 w-full" aria-label={filename} />
      </div>
    );
  }

  const isPdf = mimeType === "application/pdf";
  return (
    <a
      href={url}
      target={isPdf ? "_blank" : undefined}
      rel={isPdf ? "noopener noreferrer" : undefined}
      download={isPdf ? undefined : filename}
      className="flex w-[300px] max-w-full items-center gap-3 rounded-md border bg-muted/30 p-2.5 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {isPdf ? <FileText className="size-8 shrink-0 text-destructive/80" aria-hidden /> : <FileIcon className="size-8 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-primary">{filename}</span>
        <span className="block text-xs text-muted-foreground">
          {formatBytes(attachment.byteSize)} · {isPdf ? "PDF" : mimeType.split("/").pop()?.toUpperCase()}
        </span>
      </span>
      <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </a>
  );
}
