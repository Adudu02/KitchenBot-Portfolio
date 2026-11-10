import { z } from "zod";

export const synthesisInputSchema = z.object({
  text: z.string().min(1),
  // Optional BCP-47-ish language hint (e.g. "es", "en"). Picks a default voice
  // when `voice` is omitted. Defaults to Spanish — this is a Mexican-Spanish product.
  language: z.string().min(1).optional(),
  // Explicit provider voice/model id (e.g. "aura-2-celeste-es"). Overrides `language`.
  voice: z.string().min(1).optional(),
  // Output container/encoding. "ogg_opus" is what WhatsApp voice notes (ptt) need.
  format: z.enum(["mp3", "ogg_opus"]).optional(),
}).strict();

export type SynthesisInput = z.infer<typeof synthesisInputSchema>;

export interface SynthesisResult {
  audio: Buffer;
  mimeType: string;
  provider: string;
  model: string;
  raw: unknown;
}

export interface TextToSpeechProvider {
  synthesize(input: SynthesisInput): Promise<SynthesisResult>;
}
