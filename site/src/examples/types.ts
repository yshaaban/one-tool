export interface ExampleStep {
  explanation: string;
  command: string;
}

export type ExampleRuntimeKind = 'empty' | 'demo' | 'custom-command' | 'readOnly' | 'browser-persistence';

export type ExampleExecutionKind = 'run' | 'runDetailed';

export interface ExampleDef {
  id: string;
  title: string;
  description: string;
  browserRunnable: boolean;
  requiresApiKey: boolean;
  steps?: ExampleStep[];
  sourceFile: string;
  runtimeKind?: ExampleRuntimeKind;
  executionKind?: ExampleExecutionKind;
  autoPlay?: boolean;
  stepDelayMs?: number;
}
