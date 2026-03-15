import { createCommandRegistry, type CommandSpec } from '../src/commands/index.js';
import { INVALID_COMMAND_CASES } from './invalid-command-cases.js';
import { buildGrepRuntimeArgs, GREP_PARITY_CASES } from '../test/parity-cases/grep.js';
import { buildLsRuntimeArgs, LS_PARITY_CASES } from '../test/parity-cases/ls.js';
import { mapSedFixtureArgs, SED_PARITY_CASES } from '../test/parity-cases/sed.js';
import { TR_PARITY_CASES } from '../test/parity-cases/tr.js';
import type { CommandSnapshotCase, SnapshotFileEntry, SnapshotWorld } from './snapshot-cases.js';
import { COMMAND_EXTRA_CASES, DEFAULT_ADAPTER_WORLD } from './snapshot-cases.js';

const textEncoder = new TextEncoder();

export function buildConformanceCommandCases(): CommandSnapshotCase[] {
  const registry = createCommandRegistry();
  const cases: CommandSnapshotCase[] = [];
  const hasHelp = registry.has('help');

  for (const spec of registry.all()) {
    const representativeArgs = [...(spec.conformanceArgs ?? [])];
    const representativeWorld = representativeWorldFor(spec);

    cases.push({
      id: 'conformance-representative',
      commandName: spec.name,
      args: representativeArgs,
      ...(representativeWorld === undefined ? {} : { world: representativeWorld }),
    });

    if (hasHelp) {
      cases.push({
        id: 'conformance-help-entry',
        commandName: 'help',
        snapshotGroup: spec.name,
        args: [spec.name],
      });
    }

    if (spec.acceptsStdin === false) {
      cases.push({
        id: 'conformance-stdin-rejection',
        commandName: spec.name,
        args: representativeArgs,
        stdin: textEncoder.encode('unwanted stdin'),
        ...(representativeWorld === undefined ? {} : { world: representativeWorld }),
      });
    }

    if ((spec.minArgs ?? 0) > 0) {
      cases.push({
        id: 'conformance-too-few-args',
        commandName: spec.name,
        args: tooFewArgsFor(spec),
      });
    }

    if (spec.maxArgs !== undefined) {
      cases.push({
        id: 'conformance-too-many-args',
        commandName: spec.name,
        args: tooManyArgsFor(spec),
      });
    }

    if (spec.requiresAdapter !== undefined) {
      cases.push({
        id: `conformance-missing-${spec.requiresAdapter}-adapter`,
        commandName: spec.name,
        args: adapterArgsFor(spec),
      });
    }
  }

  return cases;
}

export function buildSnapshotCommandCases(): CommandSnapshotCase[] {
  const cases = [
    ...buildConformanceCommandCases(),
    ...COMMAND_EXTRA_CASES,
    ...buildHarvestedCommandCases(),
    ...INVALID_COMMAND_CASES,
  ];
  validateUniqueCommandCaseIds(cases);
  return cases;
}

export function validateUniqueCommandCaseIds(cases: readonly CommandSnapshotCase[]): void {
  const seen = new Set<string>();

  for (const testCase of cases) {
    const snapshotGroup = testCase.snapshotGroup ?? testCase.commandName;
    const key = `${snapshotGroup}:${testCase.id}`;
    if (seen.has(key)) {
      throw new Error(`duplicate command snapshot case: ${key}`);
    }
    seen.add(key);
  }
}

function representativeWorldFor(spec: CommandSpec): SnapshotWorld | undefined {
  if (spec.requiresAdapter === undefined) {
    return undefined;
  }

  return DEFAULT_ADAPTER_WORLD;
}

function adapterArgsFor(spec: CommandSpec): string[] {
  if (spec.conformanceArgs !== undefined && spec.conformanceArgs.length > 0) {
    return [...spec.conformanceArgs];
  }

  const count = Math.max(spec.minArgs ?? 0, 1);
  return Array.from({ length: count }, function (_, index) {
    return `arg${index}`;
  });
}

function tooFewArgsFor(spec: CommandSpec): string[] {
  const count = Math.max((spec.minArgs ?? 0) - 1, 0);
  return Array.from({ length: count }, function (_, index) {
    return `arg${index}`;
  });
}

function tooManyArgsFor(spec: CommandSpec): string[] {
  const count = (spec.maxArgs ?? 0) + 1;
  return Array.from({ length: count }, function (_, index) {
    return `arg${index}`;
  });
}

function buildHarvestedCommandCases(): CommandSnapshotCase[] {
  return [
    ...buildSedParityCommandCases(),
    ...buildTrParityCommandCases(),
    ...buildGrepParityCommandCases(),
    ...buildLsParityCommandCases(),
  ];
}

function buildSedParityCommandCases(): CommandSnapshotCase[] {
  return SED_PARITY_CASES.map(function (parityCase): CommandSnapshotCase {
    const world = snapshotWorldFromFixtureFiles(parityCase.files);
    return {
      id: `parity-${parityCase.id}`,
      commandName: 'sed',
      args: mapSedFixtureArgs(parityCase.args, toAbsoluteFixturePath),
      ...(parityCase.stdin === undefined ? {} : { stdin: parityCase.stdin }),
      ...(world === undefined ? {} : { world }),
    };
  });
}

function buildTrParityCommandCases(): CommandSnapshotCase[] {
  return TR_PARITY_CASES.map(function (parityCase): CommandSnapshotCase {
    return {
      id: `parity-${parityCase.id}`,
      commandName: 'tr',
      args: [...parityCase.args],
      stdin: parityCase.stdin,
    };
  });
}

function buildGrepParityCommandCases(): CommandSnapshotCase[] {
  return GREP_PARITY_CASES.map(function (parityCase): CommandSnapshotCase {
    const world = snapshotWorldFromFixtureFiles(parityCase.files);
    return {
      id: `parity-${parityCase.id}`,
      commandName: 'grep',
      args: buildGrepRuntimeArgs(parityCase),
      ...(parityCase.stdin === undefined ? {} : { stdin: parityCase.stdin }),
      ...(world === undefined ? {} : { world }),
    };
  });
}

function buildLsParityCommandCases(): CommandSnapshotCase[] {
  return LS_PARITY_CASES.map(function (parityCase): CommandSnapshotCase {
    const world = snapshotWorldFromFixtureFiles(parityCase.files);
    return {
      id: `parity-${parityCase.id}`,
      commandName: 'ls',
      args: buildLsRuntimeArgs(parityCase.args),
      ...(world === undefined ? {} : { world }),
    };
  });
}

function snapshotWorldFromFixtureFiles(files: Record<string, SnapshotFileEntry>): SnapshotWorld | undefined {
  if (Object.keys(files).length === 0) {
    return undefined;
  }

  const worldFiles: NonNullable<SnapshotWorld['files']> = {};

  for (const [relativePath, entry] of Object.entries(files)) {
    worldFiles[toAbsoluteFixturePath(relativePath)] = entry;
  }

  return { files: worldFiles };
}

function toAbsoluteFixturePath(filePath: string): string {
  if (filePath === '-' || filePath.startsWith('/')) {
    return filePath;
  }
  return `/${filePath}`;
}
