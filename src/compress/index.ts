/**
 * CtxPack — context compression module barrel export.
 */

export { compressMessages, compressText } from "./middleware.js";
export type { CompressResult } from "./middleware.js";

export {
  stripAnsi,
  collapseWhitespace,
  compactJson,
  deduplicateLines,
  stripComments,
  trimVerbose,
  ALL_PASSES,
  PASS_FNS,
} from "./passes.js";
export type { PassName } from "./passes.js";
