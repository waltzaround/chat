import { useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { uploadFile } from "@/lib/uploads";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";

/** Round image picker used for avatars and workspace icons. Stores the R2 key. */
export function ImagePicker({
  purpose,
  value,
  onChange,
  label,
  fallbackText,
  currentUrl,
  className,
}: {
  purpose: "avatar" | "workspace-icon";
  value: string | null;
  onChange: (key: string | null) => void;
  label: string;
  fallbackText: string;
  currentUrl?: string | null;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const url = preview ?? (value ? `/api/files/${value}` : currentUrl ?? null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image");
      return;
    }
    setBusy(true);
    try {
      const result = await uploadFile({ file, purpose });
      onChange(result.key);
      setPreview(URL.createObjectURL(file));
    } catch (err) {
      toast.error(errorMessage(err, "Upload failed"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label={label}
        disabled={busy}
        className={cn(
          "group relative flex size-20 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-border bg-muted/40 text-2xl font-semibold text-muted-foreground transition-colors hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          url && "border-solid",
        )}
      >
        {url ? <img src={url} alt="" className="size-full object-cover" /> : <span aria-hidden>{initials(fallbackText)}</span>}
        <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Camera className="size-5" aria-hidden />}
        </span>
      </button>
      {url && !busy ? (
        <button
          type="button"
          aria-label="Remove image"
          onClick={() => {
            onChange(null);
            setPreview(null);
          }}
          className="absolute -top-1 -right-1 flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
      <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} tabIndex={-1} />
    </div>
  );
}
