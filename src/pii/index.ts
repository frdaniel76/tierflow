/**
 * PII module — barrel export.
 */

export { SecretVault } from "./vault.js";
export type { RedactResult, RehydrateResult } from "./vault.js";

export { VaultStore } from "./vault-store.js";

export {
  piiVaultStore,
  scrubMessages,
  rehydrateText,
  rehydrateChunk,
  destroySession,
} from "./middleware.js";
export type { ScrubResult } from "./middleware.js";
