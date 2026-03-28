/**
 * PII module — barrel export.
 */

export { SecretVault, PII_ID_MARKER, PII_ID_MARKER_G } from "./vault.js";
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
