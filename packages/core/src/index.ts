/**
 * @quill/core — QUILL GUARD's framework-free engine. Runs in Node and in browsers.
 */

export {
  type AntiNukeDecision,
  type AntiNukeInput,
  assessThreat,
  evaluateAntiNuke,
  type RecentAction,
  resolveTrust,
  THREAT_WEIGHTS,
  type ThreatAssessment,
  type TrustInput,
  type TrustLevel,
} from './antinuke/engine.js';
export {
  SCENARIOS,
  type Scenario,
  type SimulationResult,
  type SimulationStep,
  simulate,
} from './antinuke/simulate.js';
export { evaluateJoin, type JoinDecision, type JoinInput, nameSkeleton } from './antiraid/evaluate.js';
export {
  OFFICIAL_DOMAINS,
  PROTECTED_BRANDS,
  SCAM_PHRASES,
  SEED_SCAM_DOMAINS,
} from './data/scam.js';
export { builtinWordlist, WORDLIST_SOURCES } from './data/wordlists/index.js';
export * from './detectors/index.js';
export { type AcMatch, AhoCorasick } from './matcher/aho-corasick.js';
export { type MatchOptions, type WordHit, WordMatcher } from './matcher/word-matcher.js';
export {
  applyLeet,
  type Chunk,
  collapse1,
  collapse2,
  DEFAULT_NORMALIZE_OPTIONS,
  evidenceFor,
  foldText,
  type NormalizedText,
  type NormalizedVariant,
  type NormalizeOptions,
  type NormalizeStats,
  normalize,
  normalizeTerm,
  type TextView,
  type Token,
} from './normalizer/normalize.js';
export { CONFUSABLES, LEET } from './normalizer/tables.js';
export {
  basePoints,
  decayScore,
  emptyRiskState,
  evaluateRisk,
  type RiskContext,
  type RiskDecision,
  type RiskState,
  type RiskViolation,
  riskLevel,
  trustMultiplier,
} from './risk/engine.js';
export {
  type EvaluateVerificationInput,
  evaluateVerification,
  type LinkedAccount,
  type LinkSignal,
  scoreIdentityLink,
  type VerificationEvaluation,
} from './verification/evaluate.js';
export { parseWordlist } from './wordlist/parse.js';
export { type Severity, slugify, type WordEntry } from './wordlist/types.js';
