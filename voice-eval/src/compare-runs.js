import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pocDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metricNames = ['order_accuracy', 'item_deletion_rate', 'field_error_rate'];

function resultKey({ provider, condition, sampleId }) {
  return JSON.stringify([provider, condition, sampleId]);
}

function groupKey({ provider, condition }) {
  return JSON.stringify([provider, condition]);
}

async function readRun(reference, resultsDir) {
  if (typeof reference !== 'string' || reference.trim() === '') {
    throw new TypeError('run reference must be a non-empty string');
  }

  const isPath = path.isAbsolute(reference) || reference.includes(path.sep);
  const runPath = isPath
    ? path.resolve(reference)
    : path.join(resultsDir, reference.endsWith('.json') ? reference : `${reference}.json`);
  const data = JSON.parse(await readFile(runPath, 'utf8'));
  return { path: runPath, ...data };
}

function compareMetrics(left, right) {
  return Object.fromEntries(metricNames.map((metric) => [
    metric,
    left && right ? right[metric] - left[metric] : null
  ]));
}

export async function compareRuns(leftReference, rightReference, {
  resultsDir = path.join(pocDirectory, 'results')
} = {}) {
  const [left, right] = await Promise.all([
    readRun(leftReference, resultsDir),
    readRun(rightReference, resultsDir)
  ]);
  const leftGroups = new Map(left.aggregates.map((group) => [groupKey(group), group]));
  const rightGroups = new Map(right.aggregates.map((group) => [groupKey(group), group]));
  const groupKeys = new Set([...leftGroups.keys(), ...rightGroups.keys()]);
  const metricComparisons = [...groupKeys].map((key) => {
    const leftGroup = leftGroups.get(key);
    const rightGroup = rightGroups.get(key);
    const source = leftGroup || rightGroup;
    return {
      provider: source.provider,
      condition: source.condition,
      left: leftGroup?.metrics || null,
      right: rightGroup?.metrics || null,
      delta: compareMetrics(leftGroup?.metrics, rightGroup?.metrics)
    };
  });

  const leftSamples = new Map(left.results.map((result) => [resultKey(result), result]));
  const rightSamples = new Map(right.results.map((result) => [resultKey(result), result]));
  const sampleKeys = new Set([...leftSamples.keys(), ...rightSamples.keys()]);
  const sampleChanges = [...sampleKeys].flatMap((key) => {
    const leftResult = leftSamples.get(key) || null;
    const rightResult = rightSamples.get(key) || null;
    if (JSON.stringify(leftResult) === JSON.stringify(rightResult)) {
      return [];
    }
    const source = leftResult || rightResult;
    return [{
      provider: source.provider,
      condition: source.condition,
      sampleId: source.sampleId,
      left: leftResult,
      right: rightResult
    }];
  });

  return {
    sources: { left, right },
    metricComparisons,
    sampleChanges
  };
}
