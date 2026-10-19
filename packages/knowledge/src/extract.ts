import { extractText, getDocumentProxy } from "unpdf";

/** Byte-order mark (U+FEFF) some editors add to the start of UTF-8 files. */
const BOM_PATTERN = new RegExp(`^${String.fromCharCode(0xfeff)}`);

/** PDF limits: bound CPU/memory spent on untrusted files. */
export const MAX_PDF_PAGES = 200;
export const PDF_EXTRACTION_TIMEOUT_MS = 20_000;

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Upper bound on stored document text (≈ 50k tokens), keeps indexing cost predictable. */
export const MAX_DOCUMENT_CHARS = 200_000;

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

export type SupportedKind = "text" | "markdown" | "pdf";

/** Detects the type from the extension AND the file signature (never trusts the browser type). */
export function detectKind(filename: string, bytes: Uint8Array): SupportedKind {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const isPdfSignature = bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  if (ext === "pdf") {
    if (!isPdfSignature) throw new ExtractionError("This file is not a valid PDF.");
    return "pdf";
  }
  if (isPdfSignature) throw new ExtractionError("The file extension does not match its contents.");
  if (ext === "txt") return "text";
  if (ext === "md" || ext === "markdown") return "markdown";
  throw new ExtractionError("Unsupported file type. Upload .txt, .md or .pdf files.");
}

/** Normalises whitespace and removes control characters (keeps Urdu and other scripts intact). */
export function normalizeText(text: string): string {
  return (
    text
      .replace(BOM_PATTERN, "")
      .replace(/\r\n?/g, "\n")
      // eslint-disable-next-line no-control-regex -- stripping control characters is intended
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ExtractionError("Text files must be UTF-8 encoded.");
  }
}

/** Extracts plain text from an uploaded knowledge document. Runs on the server only. */
export async function extractDocumentText(
  filename: string,
  bytes: Uint8Array,
): Promise<{ text: string; kind: SupportedKind }> {
  if (bytes.byteLength === 0) throw new ExtractionError("The file is empty.");
  if (bytes.byteLength > MAX_UPLOAD_BYTES)
    throw new ExtractionError("Files must be 5 MB or smaller.");
  const kind = detectKind(filename, bytes);

  let text: string;
  if (kind === "pdf") {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
    try {
      // Untrusted input: no font loading or XFA forms; bounded pages and time.
      pdf = await getDocumentProxy(new Uint8Array(bytes), {
        disableFontFace: true,
        useSystemFonts: false,
        enableXfa: false,
      });
      if (pdf.numPages > MAX_PDF_PAGES) {
        throw new ExtractionError(`PDFs are limited to ${MAX_PDF_PAGES} pages.`);
      }
      const result = await Promise.race([
        extractText(pdf, { mergePages: true }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ExtractionError("Reading this PDF took too long.")),
            PDF_EXTRACTION_TIMEOUT_MS,
          );
        }),
      ]);
      text = result.text;
    } catch (err) {
      if (err instanceof ExtractionError) throw err;
      throw new ExtractionError(
        "Could not read text from this PDF (it may be scanned or encrypted).",
      );
    } finally {
      if (timer) clearTimeout(timer);
      await pdf?.loadingTask.destroy().catch(() => undefined);
    }
  } else {
    text = decodeUtf8(bytes);
  }

  const normalized = normalizeText(text);
  if (normalized.length < 20)
    throw new ExtractionError("The document has too little readable text.");
  if (normalized.length > MAX_DOCUMENT_CHARS) {
    throw new ExtractionError(
      `Documents are limited to ${MAX_DOCUMENT_CHARS.toLocaleString("en")} characters.`,
    );
  }
  return { text: normalized, kind };
}
