import assert from 'node:assert/strict';
import test from 'node:test';

import { SimpleMemory } from '../src/memory.js';
import { AgentCLI } from '../src/runtime.js';
import { MemoryVFS } from '../src/vfs/memory-vfs.js';
import {
  type SerializedRunExecution,
  type SerializedWorldState,
  serializeRunExecution,
  snapshotWorldState,
  withMockedNow,
} from '../scripts/snapshot/shared.js';
import { runPythonDifferentialDriver } from './differential/python-driver.js';
import {
  EDITING_WORKFLOW_CASES,
  EDITING_WORKFLOW_SETUP_COMMANDS,
  type EditingWorkflowCase,
} from './parity-cases/editing-workflows.js';

interface DifferentialWorkflowResult {
  executions: SerializedRunExecution[];
  worldAfter: SerializedWorldState;
}

interface PythonWorkflowBatchResponse {
  results: DifferentialWorkflowResult[];
}

interface RuntimeWorkflowRequest {
  commands: string[];
  id: string;
  setupCommands: string[];
}

test('editing workflows stay in parity between TypeScript and Python', async function (t): Promise<void> {
  assert.ok(EDITING_WORKFLOW_CASES.length > 0, 'expected editing workflow cases');
  const workflows = EDITING_WORKFLOW_CASES.map(function (workflow): RuntimeWorkflowRequest {
    return {
      id: workflow.id,
      setupCommands: [...EDITING_WORKFLOW_SETUP_COMMANDS],
      commands: [...workflow.commands],
    };
  });
  const python = await runPythonDifferentialDriver<
    { kind: 'runtime-workflows'; workflows: RuntimeWorkflowRequest[] },
    PythonWorkflowBatchResponse
  >({
    kind: 'runtime-workflows',
    workflows,
  });

  assert.equal(python.results.length, workflows.length, 'python workflow differential returned unexpected case count');

  for (let index = 0; index < EDITING_WORKFLOW_CASES.length; index += 1) {
    const workflow = EDITING_WORKFLOW_CASES[index]!;
    const pythonResult = python.results[index]!;

    await t.test(workflow.id, async function (): Promise<void> {
      const typescriptResult = await runTypescriptWorkflow(workflow);
      assert.deepEqual(typescriptResult, pythonResult, `${workflow.title}: typescript/python workflow mismatch`);
    });
  }
});

async function runTypescriptWorkflow(workflow: EditingWorkflowCase): Promise<DifferentialWorkflowResult> {
  return withMockedNow(async function (): Promise<DifferentialWorkflowResult> {
    const runtime = new AgentCLI({
      vfs: new MemoryVFS(),
      memory: new SimpleMemory(),
    });
    await runtime.initialize();

    return {
      executions: await runWorkflowCommands(runtime, [...EDITING_WORKFLOW_SETUP_COMMANDS, ...workflow.commands]),
      worldAfter: await snapshotWorldState(runtime.ctx.vfs, runtime.ctx.memory),
    };
  });
}

async function runWorkflowCommands(runtime: AgentCLI, commandLines: readonly string[]): Promise<SerializedRunExecution[]> {
  const executions: SerializedRunExecution[] = [];

  for (const commandLine of commandLines) {
    const execution = await runtime.runDetailed(commandLine);
    executions.push(serializeRunExecution(execution));
  }

  return executions;
}
