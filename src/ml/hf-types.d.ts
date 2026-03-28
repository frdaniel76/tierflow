/**
 * Minimal type declarations for @huggingface/transformers (optional dependency).
 */
declare module "@huggingface/transformers" {
  export function pipeline(
    task: string,
    model: string,
    options?: Record<string, unknown>,
  ): Promise<(text: string, options?: Record<string, unknown>) => Promise<{ data: Float32Array }>>;
}
