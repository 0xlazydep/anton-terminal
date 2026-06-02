export { DeepSeekClient } from "./deepseek.js";
export type {
  DeepSeekClientOptions,
  DeepSeekTool,
  DeepSeekMessage,
  DeepSeekChatRequest,
} from "./deepseek.js";
export { decide, decideExit } from "./decide.js";
export type {
  DecideContext,
  DecideOptions,
  ReasoningStep,
  ExitDecision,
} from "./decide.js";
export {
  entryQualityScore,
  riskAdjustedSize,
  feeEfficiencyGate,
  expectedValueGate,
  winProbabilityFor,
} from "./scoring.js";
export type {
  EntryScore,
  EntryScoreComponent,
  SizeInputs,
  SizeResult,
  PatternStat,
  FeeContext,
  EfficiencyGate,
  ExpectedValueInputs,
  ExpectedValueResult,
} from "./scoring.js";
