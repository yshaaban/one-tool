export {
  NO_STDIN,
  createTestCommandContext,
  createTestCommandRegistry,
  getRegisteredCommand,
  runRegisteredCommand,
  stdinText,
  stdoutText,
} from './command-harness.js';
export { DemoFetch, DemoSearch, type DemoSearchDocument } from './adapters.js';
export { createCommandConformanceCases } from './command-conformance.js';
export { assertScenario, type AssertionResult } from './assert-scenario.js';
export { runOracle, type OracleStepTrace, type OracleTrace } from './oracle-runner.js';
export { buildWorld } from './world-builder.js';
export type {
  CreateTestCommandContextOptions,
  RunRegisteredCommandOptions,
  RunRegisteredCommandResult,
} from './command-harness.js';
export type { CommandConformanceCase, CommandConformanceOptions } from './command-conformance.js';
export type {
  AssertionSpec,
  FileAssertionSpec,
  MemoryAssertionSpec,
  OracleCommandSpec,
  ScenarioCategory,
  ScenarioPromptVariant,
  ScenarioSpec,
  TextAssertionSpec,
  TraceAssertionSpec,
  TraceStepAssertionSpec,
  WorldSpec,
} from './scenario.js';
