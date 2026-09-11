import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OrganisationGraph } from '../src/organisation-graph.js';
import { buildHierarchy } from '../src/hierarchy.js';
import { subtreeFindingCounts, SEVERITY, FINDING_KIND } from '../src/findings.js';
import { iriOf, describedOrganisation, symmetricEdge } from './quad-builder.js';

const ROOT = iriOf('185.90.0.0');
const FACULTY = iriOf('185.11.0.0');
const OTHER_FACULTY = iriOf('185.12.0.0');
const SECTION = iriOf('185.11.0.10');
const OTHER_SECTION = iriOf('185.11.0.20');

const hierarchy = () => {
  const graph = new OrganisationGraph();
  graph.addDocument(ROOT, [
    ...describedOrganisation(ROOT, 'Universitetet i Oslo', 'University of Oslo'),
    ...describedOrganisation(FACULTY, 'Det teologiske fakultet', 'Faculty of Theology'),
    ...describedOrganisation(OTHER_FACULTY, 'Det juridiske fakultet', 'Faculty of Law'),
    ...describedOrganisation(SECTION, 'Seksjon A', 'Section A'),
    ...describedOrganisation(OTHER_SECTION, 'Seksjon B', 'Section B'),
    ...symmetricEdge(ROOT, FACULTY),
    ...symmetricEdge(ROOT, OTHER_FACULTY),
    ...symmetricEdge(FACULTY, SECTION),
    ...symmetricEdge(FACULTY, OTHER_SECTION),
  ]);
  return buildHierarchy(graph, ROOT);
};

const finding = (kind, severity, subjects) => ({ kind, severity, subjects, detail: {} });

const NO_FINDINGS = Object.freeze({ [SEVERITY.PROBLEM]: 0, [SEVERITY.WARNING]: 0, [SEVERITY.NOTE]: 0 });

describe('subtreeFindingCounts', () => {
  it('shouldReturnZeroCountsForEveryUnitWhenThereAreNoFindings', () => {
    const counts = subtreeFindingCounts(hierarchy(), []);

    assert.equal(counts.size, 5);
    assert.deepEqual(counts.get(ROOT), NO_FINDINGS);
    assert.deepEqual(counts.get(SECTION), NO_FINDINGS);
  });

  it('shouldNotCountAUnitsOwnFindingsInItsOwnBubble', () => {
    const findings = [finding(FINDING_KIND.CONFLICTING_LABELS, SEVERITY.PROBLEM, [FACULTY])];

    const counts = subtreeFindingCounts(hierarchy(), findings);

    assert.deepEqual(counts.get(FACULTY), NO_FINDINGS);
    assert.equal(counts.get(ROOT)[SEVERITY.PROBLEM], 1);
  });

  it('shouldCountFindingsOfDeepDescendantsAtEveryAncestor', () => {
    const findings = [finding(FINDING_KIND.UNDESCRIBED, SEVERITY.WARNING, [SECTION])];

    const counts = subtreeFindingCounts(hierarchy(), findings);

    assert.equal(counts.get(FACULTY)[SEVERITY.WARNING], 1);
    assert.equal(counts.get(ROOT)[SEVERITY.WARNING], 1);
    assert.equal(counts.get(OTHER_FACULTY)[SEVERITY.WARNING], 0);
  });

  it('shouldCountAFindingWithSeveralSubjectsInTheSameSubtreeOnce', () => {
    const findings = [finding(FINDING_KIND.DUPLICATE_SIBLING_LABEL, SEVERITY.PROBLEM, [SECTION, OTHER_SECTION])];

    const counts = subtreeFindingCounts(hierarchy(), findings);

    assert.equal(counts.get(FACULTY)[SEVERITY.PROBLEM], 1);
    assert.equal(counts.get(ROOT)[SEVERITY.PROBLEM], 1);
  });

  it('shouldTallyEachSeveritySeparately', () => {
    const findings = [
      finding(FINDING_KIND.CONFLICTING_LABELS, SEVERITY.PROBLEM, [SECTION]),
      finding(FINDING_KIND.UNDESCRIBED, SEVERITY.WARNING, [OTHER_SECTION]),
      finding(FINDING_KIND.UNTRANSLATED_LABEL, SEVERITY.NOTE, [SECTION]),
      finding(FINDING_KIND.UNTRANSLATED_LABEL, SEVERITY.NOTE, [OTHER_FACULTY]),
    ];

    const counts = subtreeFindingCounts(hierarchy(), findings);

    assert.deepEqual(counts.get(ROOT), { [SEVERITY.PROBLEM]: 1, [SEVERITY.WARNING]: 1, [SEVERITY.NOTE]: 2 });
    assert.deepEqual(counts.get(FACULTY), { [SEVERITY.PROBLEM]: 1, [SEVERITY.WARNING]: 1, [SEVERITY.NOTE]: 1 });
  });
});
