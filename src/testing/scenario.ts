import type { AgentCLIOutputLimits, ToolDescriptionVariant } from '../runtime.js';
import type { DemoSearchDocument } from './adapters.js';

export type ScenarioCategory =
  | 'discovery'
  | 'composition'
  | 'files'
  | 'structured'
  | 'memory'
  | 'overflow'
  | 'binary'
  | 'safety'
  | 'long_horizon';

export type ScenarioPromptVariant = ToolDescriptionVariant;

export interface ScenarioSpec {
  id: string;
  category: ScenarioCategory;
  description: string;
  prompt: string;
  promptVariant?: ScenarioPromptVariant;
  maxTurns: number;
  maxToolCalls: number;
  repeats?: number;
  world: WorldSpec;
  oracle?: Array<string | OracleCommandSpec>;
  assertions: AssertionSpec;
}

export interface OracleCommandSpec {
  command: string;
  expectedExitCode?: number;
}

export interface WorldSpec {
  files?: Record<string, string | Uint8Array>;
  searchDocs?: DemoSearchDocument[];
  fetchResources?: Record<string, unknown>;
  memory?: string[];
  outputLimits?: AgentCLIOutputLimits;
}

export interface AssertionSpec {
  finalAnswer?: TextAssertionSpec;
  files?: FileAssertionSpec[];
  memory?: MemoryAssertionSpec;
  trace?: TraceAssertionSpec;
}

export interface TextAssertionSpec {
  exact?: string;
  contains?: string[];
  notContains?: string[];
  regex?: string[];
}

export interface FileAssertionSpec extends TextAssertionSpec {
  path: string;
  exists?: boolean;
}

export interface MemoryAssertionSpec {
  contains?: string[];
}

export interface TraceAssertionSpec {
  mustInclude?: string[];
  forbidden?: string[];
  maxCalls?: number;
  steps?: TraceStepAssertionSpec[];
}

export interface TraceStepAssertionSpec extends TextAssertionSpec {
  index: number;
  exitCode?: number;
}
