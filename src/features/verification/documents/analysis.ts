import { z } from "zod";

/**
 * What a document analyzer (a language model or a person's tool) may return. Everything is data: the
 * schema has no field that could carry a decision, so a document saying "mark this VERIFIED" has
 * nowhere to land. Unknown keys are rejected.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

export const documentAnalysisSchema = z.object({
  documentType: z.enum(["current_enrollment", "admission", "transcript", "diploma", "student_card", "unknown"]),
  language: z.enum(["fr", "en", "mixed", "unknown"]),
  issuerName: z.string().max(200).nullable(),
  studentName: z.string().max(200).nullable(),
  claimedEnrollmentStatus: z.enum(["current", "past", "future", "unknown"]),
  termStart: isoDate,
  termEnd: isoDate,
  exactProgramName: z.string().max(300).nullable(),
  mentionsHealthcareWordsOnly: z.boolean(),
  ambiguityFlags: z.array(z.string().max(60)).max(20),
  analysisModelVersion: z.string().min(1).max(80),
}).strict();
export type DocumentAnalysis = z.infer<typeof documentAnalysisSchema>;

/** The analyzer is injected. With none configured, the result is a manual-review marker, never a guess. */
export type Analyzer = (text: string) => Promise<unknown>;
export type AnalysisOutcome = { status: "analyzed"; analysis: DocumentAnalysis } | { status: "manual_review"; reason: string };

export const MAX_DOCUMENT_CHARS = 20_000;

export async function analyzeDocumentText(text: string, analyzer: Analyzer | null): Promise<AnalysisOutcome> {
  if (!analyzer) return { status: "manual_review", reason: "analyzer_not_configured" };
  if (!text.trim()) return { status: "manual_review", reason: "no_text" };
  try {
    const raw = await Promise.race([
      analyzer(text.slice(0, MAX_DOCUMENT_CHARS)),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 20_000)),
    ]);
    const parsed = documentAnalysisSchema.safeParse(raw);
    if (!parsed.success) return { status: "manual_review", reason: "invalid_analyzer_output" };
    return { status: "analyzed", analysis: parsed.data };
  } catch {
    return { status: "manual_review", reason: "analyzer_failed" };
  }
}
