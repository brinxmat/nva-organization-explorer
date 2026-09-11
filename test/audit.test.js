import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseIriList, classify, AUDIT_CATEGORY, AUDIT_COLUMNS } from '../src/audit.js';
import { iriOf, ORGANISATION_BASE } from './quad-builder.js';

const ROOT = iriOf('185.90.0.0');
const FACULTY = iriOf('185.11.0.0');

describe('parseIriList', () => {
  it('shouldReturnEmptyForBlankInput', () => {
    assert.deepEqual(parseIriList('  \n ', ORGANISATION_BASE), { iris: [], rejected: [] });
  });

  it('shouldRejectTextThatIsNeitherIriNorIdentifier', () => {
    const parsed = parseIriList('hello https://example.org/other', ORGANISATION_BASE);

    assert.deepEqual(parsed.iris, []);
    assert.deepEqual(parsed.rejected, ['hello', 'https://example.org/other']);
  });

  it('shouldAcceptIrisAndBareIdentifiersSeparatedByAnyWhitespaceOrComma', () => {
    const parsed = parseIriList(`${ROOT}, 185.11.0.0\n${FACULTY};`, ORGANISATION_BASE);

    assert.deepEqual(parsed.iris, [ROOT, FACULTY]);
    assert.deepEqual(parsed.rejected, []);
  });

  it('shouldStripQuotesAroundEntries', () => {
    const parsed = parseIriList(`"${ROOT}" '185.11.0.0'`, ORGANISATION_BASE);

    assert.deepEqual(parsed.iris, [ROOT, FACULTY]);
  });
});

describe('classify', () => {
  it('shouldReportNotFoundWhenDereferenceFailed', () => {
    assert.equal(classify({ httpStatus: 404, inTree: false, inRegistry: false, registryLoaded: true }), AUDIT_CATEGORY.NOT_FOUND);
  });

  it('shouldReportInTreeWhenPresentInServedTree', () => {
    assert.equal(classify({ httpStatus: 200, inTree: true, inRegistry: true, registryLoaded: true }), AUDIT_CATEGORY.IN_TREE);
  });

  it('shouldReportOrphanWhenRegisteredButNotInTree', () => {
    assert.equal(classify({ httpStatus: 200, inTree: false, inRegistry: true, registryLoaded: true }), AUDIT_CATEGORY.ORPHAN);
  });

  it('shouldReportGhostWhenDereferenceableButNeitherRegisteredNorInTree', () => {
    assert.equal(classify({ httpStatus: 200, inTree: false, inRegistry: false, registryLoaded: true }), AUDIT_CATEGORY.GHOST);
  });

  it('shouldReportOutsideTreeWhenRegistryNotLoaded', () => {
    assert.equal(classify({ httpStatus: 200, inTree: false, inRegistry: undefined, registryLoaded: false }), AUDIT_CATEGORY.OUTSIDE_TREE);
  });

  it('shouldReportOtherRootWhenAncestorChainEndsElsewhere', () => {
    assert.equal(classify({ httpStatus: 200, inTree: false, inRegistry: false, registryLoaded: true, underLoadedRoot: false }), AUDIT_CATEGORY.OTHER_ROOT);
  });

  it('shouldNotReportOtherRootWhenUnitIsInTree', () => {
    assert.equal(classify({ httpStatus: 200, inTree: true, inRegistry: true, registryLoaded: true, underLoadedRoot: false }), AUDIT_CATEGORY.IN_TREE);
  });

  it('shouldReportErrorForOtherFailures', () => {
    assert.equal(classify({ httpStatus: 502, inTree: false, inRegistry: false, registryLoaded: true }), AUDIT_CATEGORY.ERROR);
  });
});

describe('AUDIT_COLUMNS', () => {
  it('shouldIncludeCategoryAndIri', () => {
    const keys = AUDIT_COLUMNS.map((column) => column.key);

    assert.ok(keys.includes('category'));
    assert.ok(keys.includes('iri'));
  });
});
