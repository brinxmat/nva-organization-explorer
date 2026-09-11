import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { unmappedKeys, jsonOnlyPropertiesById } from '../src/json-inspection.js';

const CONTEXT_TERMS = new Set(['id', 'type', 'labels', 'partOf', 'hasPart', 'country']);

const document = {
  '@context': 'https://example.org/context.json',
  id: 'https://example.org/org/1',
  type: 'Organization',
  labels: { nb: 'Rot' },
  acronym: 'ROT',
  hasPart: [{ id: 'https://example.org/org/2', type: 'Organization', acronym: 'BARN', labels: {}, hasPart: [] }],
};

describe('unmappedKeys', () => {
  it('shouldReturnEmptySetWhenEveryKeyIsMapped', () => {
    assert.deepEqual(unmappedKeys({ id: 'x', labels: {} }, CONTEXT_TERMS), new Set());
  });

  it('shouldIgnoreJsonLdKeywords', () => {
    assert.equal(unmappedKeys(document, CONTEXT_TERMS).has('@context'), false);
  });

  it('shouldCollectKeysAbsentFromContextAtEveryDepth', () => {
    assert.deepEqual(unmappedKeys(document, CONTEXT_TERMS), new Set(['acronym']));
  });

  it('shouldNotTreatLanguageMapKeysAsProperties', () => {
    assert.equal(unmappedKeys(document, CONTEXT_TERMS).has('nb'), false);
  });
});

describe('jsonOnlyPropertiesById', () => {
  it('shouldReturnEmptyMapWhenNothingIsUnmapped', () => {
    assert.deepEqual(jsonOnlyPropertiesById({ id: 'x', labels: {} }, CONTEXT_TERMS), new Map());
  });

  it('shouldGroupUnmappedScalarValuesByNodeId', () => {
    const properties = jsonOnlyPropertiesById(document, CONTEXT_TERMS);

    assert.deepEqual(properties.get('https://example.org/org/1'), { acronym: 'ROT' });
    assert.deepEqual(properties.get('https://example.org/org/2'), { acronym: 'BARN' });
  });

  it('shouldSkipObjectsWithoutId', () => {
    const properties = jsonOnlyPropertiesById({ acronym: 'X', labels: {} }, CONTEXT_TERMS);

    assert.equal(properties.size, 0);
  });
});
