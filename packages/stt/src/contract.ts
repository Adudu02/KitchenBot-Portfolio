import { z } from "zod";

export const transcriptionInputSchema = z.object({
  audio: z.union([z.instanceof(Buffer), z.string().min(1)]),
  mimeType: z.string().min(1),
  language: z.string().min(1),
  vocabularyHints: z.array(z.string().refine(
    (value) => value.trim().length > 0,
    "Vocabulary hints must not be blank",
  )).optional(),
}).strict();

export type TranscriptionInput = z.infer<typeof transcriptionInputSchema>;

export interface TranscriptionResult {
  text: string;
  provider: string;
  model: string;
  raw: unknown;
}

export interface SpeechToTextProvider {
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}
