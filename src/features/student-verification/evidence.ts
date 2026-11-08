/**
 * Static inspection of an evidence file's real bytes. This is NOT antivirus: it checks the file is
 * what it claims (PDF, JPEG or PNG by signature), is within the size limit, and refuses PDFs that
 * carry scripts, launch actions, embedded files, forms-XFA or encryption (we cannot inspect those).
 * shortcut: PDF features hidden inside compressed object streams are not seen by this scan; upgrade
 * path is an antivirus/CDR service (set EVIDENCE_AV_REQUIRED=true so files stay unopened until one
 * passes). Pure and synchronous so it is tested directly.
 */
export const EVIDENCE_BUCKET = "student-verification-evidence";
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

export type InspectResult =
  | { ok: true; mime: "application/pdf" | "image/jpeg" | "image/png"; ext: "pdf" | "jpg" | "png" }
  | { ok: false; reason: string };

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

const RISKY_PDF = ["/JavaScript", "/JS", "/Launch", "/EmbeddedFile", "/Encrypt", "/RichMedia", "/XFA", "/OpenAction", "/AA", "/SubmitForm"];

export function inspectEvidence(bytes: Uint8Array, declaredMime?: string): InspectResult {
  if (bytes.length === 0) return { ok: false, reason: "The file is empty." };
  if (bytes.length > MAX_EVIDENCE_BYTES) return { ok: false, reason: "The file is larger than 5 MB." };

  let detected: "application/pdf" | "image/jpeg" | "image/png" | null = null;
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) detected = "application/pdf";
  else if (startsWith(bytes, [0xff, 0xd8, 0xff])) detected = "image/jpeg";
  else if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) detected = "image/png";
  if (!detected) return { ok: false, reason: "Only PDF, JPG and PNG files are accepted." };
  if (declaredMime && declaredMime !== detected && !(declaredMime === "image/jpg" && detected === "image/jpeg")) {
    return { ok: false, reason: "The file type does not match its contents." };
  }

  if (detected === "application/pdf") {
    const text = Buffer.from(bytes).toString("latin1");
    if (!text.slice(-2048).includes("%%EOF")) return { ok: false, reason: "The PDF looks damaged or incomplete." };
    for (const token of RISKY_PDF) {
      // Names end at a delimiter, so "/JS" does not match "/JSON".
      if (new RegExp(`${token.replace("/", "\\/")}(?![A-Za-z0-9])`).test(text)) {
        return { ok: false, reason: "The PDF contains scripts, embedded files or encryption and cannot be inspected safely." };
      }
    }
    return { ok: true, mime: detected, ext: "pdf" };
  }
  if (detected === "image/png") {
    const tail = Buffer.from(bytes.slice(-16)).toString("latin1");
    if (!tail.includes("IEND")) return { ok: false, reason: "The image looks damaged or incomplete." };
    return { ok: true, mime: detected, ext: "png" };
  }
  if (!(bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9)) {
    return { ok: false, reason: "The image looks damaged or incomplete." };
  }
  return { ok: true, mime: detected, ext: "jpg" };
}

/** A pasted share number or link is stored as plain text only. Links must be https; nothing is fetched. */
export function cleanReference(value: string): { ok: true; value: string } | { ok: false; reason: string } {
  const v = value.trim();
  if (v.length < 4 || v.length > 500) return { ok: false, reason: "Enter the share number or link (4 to 500 characters)." };
  if (/[\u0000-\u001f]/.test(v)) return { ok: false, reason: "That reference contains invalid characters." };
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^https:\/\//i.test(v)) {
    return { ok: false, reason: "Only https links are accepted." };
  }
  return { ok: true, value: v };
}
