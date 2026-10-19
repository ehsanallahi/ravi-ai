import { describe, expect, it } from "vitest";
import {
  detectKind,
  ExtractionError,
  extractDocumentText,
  MAX_UPLOAD_BYTES,
  normalizeText,
} from "./extract";

const enc = (s: string) => new TextEncoder().encode(s);

/** A minimal, valid one-page PDF containing the text "Kurta price Rs 2500". */
function tinyPdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc(body);
}

describe("document extraction", () => {
  it("extracts UTF-8 text and markdown, keeping Urdu intact", async () => {
    const urdu = "ہماری دکان پیر سے جمعہ تک کھلی ہے۔ ڈیلیوری لاہور میں دستیاب ہے۔";
    expect(
      (await extractDocumentText("faq.txt", enc(`${String.fromCharCode(0xfeff)}${urdu}\r\n`))).text,
    ).toBe(urdu);
    expect(
      (await extractDocumentText("faq.md", enc("# Returns\n\nReturns accepted within 14 days.")))
        .kind,
    ).toBe("markdown");
  });

  it("extracts text from a PDF", async () => {
    const { text, kind } = await extractDocumentText(
      "prices.pdf",
      tinyPdf("Kurta price Rs 2500 per piece"),
    );
    expect(kind).toBe("pdf");
    expect(text).toContain("Kurta price Rs 2500");
  });

  it("validates type by signature, not just extension", () => {
    expect(() => detectKind("fake.pdf", enc("not a pdf at all"))).toThrow(ExtractionError);
    expect(() => detectKind("renamed.txt", enc("%PDF-1.7 ..."))).toThrow(/does not match/);
    expect(() => detectKind("script.exe", enc("MZ..."))).toThrow(/Unsupported/);
  });

  it("rejects empty, oversized, tiny and non-UTF-8 files", async () => {
    await expect(extractDocumentText("a.txt", new Uint8Array())).rejects.toThrow(/empty/);
    await expect(
      extractDocumentText("a.txt", new Uint8Array(MAX_UPLOAD_BYTES + 1)),
    ).rejects.toThrow(/5 MB/);
    await expect(extractDocumentText("a.txt", enc("hi"))).rejects.toThrow(/too little/);
    await expect(
      extractDocumentText("a.txt", new Uint8Array([0xff, 0xfe, 0xfd, 0x41, 0x42])),
    ).rejects.toThrow(/UTF-8/);
  });

  it("normalizes whitespace and strips control characters", () => {
    expect(normalizeText("a\u0000b  \r\n\r\n\r\n\r\nc")).toBe("ab\n\nc");
  });
});
