import assert from 'node:assert/strict';
import test from 'node:test';

import { adversarialScenarios } from './scenarios/adversarial.js';
import { coreScenarios } from './scenarios/core.js';

const EXPECTED_CORE_SCENARIO_IDS = [
  'help-discovery-tail',
  'log-error-count',
  'timeout-tail',
  'fallback-config',
  'fetch-json-field',
  'search-write-report',
  'file-copy-and-append',
  'memory-distill-owner',
  'binary-recovery-logo',
  'overflow-navigation-large-log',
];

const EXPECTED_ADVERSARIAL_SCENARIO_IDS = [
  'unsupported-shell-syntax-redirection',
  'invalid-command-recovery',
  'path-traversal-clamped',
  'malformed-json-recovery',
];

test('scenario catalog matches the deterministic strategy baseline', function (): void {
  assert.equal(coreScenarios.length, 10, 'expected 10 core scenarios');
  assert.ok(adversarialScenarios.length >= 1, 'expected at least one adversarial scenario');
  assert.deepEqual(
    coreScenarios.map(function (scenario) {
      return scenario.id;
    }),
    EXPECTED_CORE_SCENARIO_IDS,
    'core scenario ids should stay aligned with the documented benchmark set',
  );
  assert.deepEqual(
    adversarialScenarios.map(function (scenario) {
      return scenario.id;
    }),
    EXPECTED_ADVERSARIAL_SCENARIO_IDS,
    'adversarial scenario ids should stay aligned with the documented safety set',
  );

  const allScenarios = [...coreScenarios, ...adversarialScenarios];
  const ids = new Set<string>();

  for (const scenario of allScenarios) {
    assert.ok(scenario.id.length > 0, 'scenario id must be non-empty');
    assert.ok(!ids.has(scenario.id), `duplicate scenario id: ${scenario.id}`);
    ids.add(scenario.id);

    assert.ok(scenario.description.length > 0, `${scenario.id} must have a description`);
    assert.ok(scenario.prompt.length > 0, `${scenario.id} must have a prompt`);
    assert.ok(scenario.maxTurns > 0, `${scenario.id} must allow at least one turn`);
    assert.ok(scenario.maxToolCalls > 0, `${scenario.id} must allow at least one tool call`);
    assert.ok(scenario.oracle !== undefined, `${scenario.id} must define a deterministic oracle`);
    assert.ok(scenario.oracle.length > 0, `${scenario.id} must define a non-empty deterministic oracle`);
    assert.ok(
      scenario.oracle.length <= scenario.maxToolCalls,
      `${scenario.id} oracle exceeds maxToolCalls=${scenario.maxToolCalls}`,
    );
  }

  for (const scenario of adversarialScenarios) {
    assert.equal(scenario.category, 'safety', `${scenario.id} should use the safety category`);
  }
});
