import { apiPost } from "./api";
import type { Attachment, UploadAuthorization } from "@shared/types";

export interface UploadProgress {
  loaded: number;
  total: number;
}

interface UploadBase {
  file: File;
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
}

export type UploadInput = (UploadBase & { purpose: "attachment"; channelId: string }) | (UploadBase & { purpose: "avatar" | "workspace-icon" });

/**
 * Two-step upload: authorise with the Worker, PUT straight to R2 (or through
 * the Worker in local dev), then confirm so the Worker records metadata.
 */
export async function uploadFile(input: UploadInput & { purpose: "attachment" }): Promise<Attachment>;
export async function uploadFile(input: UploadInput & { purpose: "avatar" | "workspace-icon" }): Promise<{ key: string; url: string }>;
export async function uploadFile(input: UploadInput): Promise<Attachment | { key: string; url: string }> {
  const { file } = input;
  const mimeType = file.type || "application/octet-stream";
  const auth = await apiPost<UploadAuthorization>("/api/uploads/authorize", {
    channelId: input.purpose === "attachment" ? input.channelId : "none",
    filename: file.name,
    mimeType,
    byteSize: file.size,
    purpose: input.purpose,
  });

  await putWithProgress(auth, file, input.onProgress, input.signal);

  const dims = await measure(file).catch(() => ({}));
  return apiPost("/api/uploads/complete", { attachmentId: auth.attachmentId, ...dims });
}

function putWithProgress(auth: UploadAuthorization, file: File, onProgress?: (p: UploadProgress) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", auth.uploadUrl);
    for (const [k, v] of Object.entries(auth.headers)) xhr.setRequestHeader(k, v);
    if (auth.mode === "proxy") xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.({ loaded: e.loaded, total: e.total });
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed — check your connection"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

async function measure(file: File): Promise<{ width?: number; height?: number; duration?: number }> {
  if (file.type.startsWith("image/")) {
    const bmp = await createImageBitmap(file);
    const out = { width: bmp.width, height: bmp.height };
    bmp.close();
    return out;
  }
  if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
    return new Promise((resolve) => {
      const el = document.createElement(file.type.startsWith("video/") ? "video" : "audio") as HTMLVideoElement;
      const url = URL.createObjectURL(file);
      const done = () => {
        URL.revokeObjectURL(url);
        resolve({
          width: "videoWidth" in el && el.videoWidth ? el.videoWidth : undefined,
          height: "videoHeight" in el && el.videoHeight ? el.videoHeight : undefined,
          duration: Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : undefined,
        });
      };
      el.preload = "metadata";
      el.onloadedmetadata = done;
      el.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({});
      };
      el.src = url;
    });
  }
  return {};
}
