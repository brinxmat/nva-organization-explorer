import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OrganisationGraph } from '../src/organisation-graph.js';
import { analyse, FINDING_KIND, SEVERITY, worstSeverity } from '../src/findings.js';
import {
  iriOf,
  describedOrganisation,
  symmetricEdge,
  hasPartQuad,
  partOfQuad,
  labelQuad,
} from './quad-builder.js';

const ROOT = iriOf('185.90.0.0');
const FACULTY = iriOf('185.11.0.0');
const OTHER_FACULTY = iriOf('185.12.0.0');
const SECTION = iriOf('185.11.0.10');
const OTHER_SECTION = iriOf('185.12.0.10');
const SHADOW_ROOT = iriOf('185.0.0.0');

const findingsOfKind = (findings, kind) => findings.filter((finding) => finding.kind === kind);

const wellFormedUniversity = () => {
  const graph = new OrganisationGraph();
  graph.addDocument(ROOT, [
    ...describedOrganisation(ROOT, 'Universitetet i Oslo', 'University of Oslo'),
    ...describedOrganisation(FACULTY, 'Det teologiske fakultet', 'Faculty of Theology'),
    ...describedOrganisation(SECTION, 'Fakultetssekretariatet', 'Faculty Secretariat'),
    ...symmetricEdge(ROOT, FACULTY),
    ...symmetricEdge(FACULTY, SECTION),
  ]);
  return graph;
};

describe('analyse', () => {
  it('shouldThrowWhenRootIsNotInGraph', () => {
    const graph = new OrganisationGraph();

    assert.throws(() => analyse(graph, ROOT), /root/);
  });

  it('shouldReportNothingForWellFormedHierarchy', () => {
    const graph = wellFormedUniversity();

    const findings = analyse(graph, ROOT);

    assert.deepEqual(findings, []);
  });

  it('shouldFlagSiblingsSharingLabelInSameLanguage', () => {
    const graph = wellFormedUniversity();
    graph.addDocument(OTHER_FACULTY, [
      ...describedOrganisation(OTHER_FACULTY, 'Det teologiske fakultet', 'Faculty of Law'),
      ...symmetricEdge(ROOT, OTHER_FACULTY),
    ]);

    const [finding] = findingsOfKind(analyse(graph, ROOT), FINDING_KIND.DUPLICATE_SIBLING_LABEL);

    assert.equal(finding.severity, SEVERITY.PROBLEM);
    assert.deepEqual([...finding.subjects].sort(), [FACULTY, OTHER_FACULTY].sort());
    assert.deepEqual(finding.detail, { parent: ROOT, language: 'nb', label: 'Det teologiske fakultet' });
  });

  it('shouldNoteLabelsRepeatedAcrossTheInstitutionWithoutBeingSiblings', () => {
    const graph = wellFormedUniversity();
    graph.addDocument(OTHER_FACULTY, [
      ...describedOrganisation(OTHER_FACULTY, 'Det juridiske fakultet', 'Faculty of Law'),
      ...describedOrganisation(OTHER_SECTION, 'Fakultetssekretariatet', 'Faculty Secretariat'),
      ...symmetricEdge(ROOT, OTHER_FACULTY),
      ...symmetricEdge(OTHER_FACULTY, OTHER_SECTION),
    ]);

    const repeated = findingsOfKind(analyse(graph, ROOT), FINDING_KIND.REPEATED_LABEL);

    assert.equal(repeated.length, 2);
    assert.ok(repeated.every((finding) => finding.severity === SEVERITY.NOTE));
    assert.deepEqual([...repeated[0].subjects].sort(), [SECTION, OTHER_SECTION].sort());
  });

  it('shouldNoteUntranslatedLabels', () => {
    const graph = new OrganisationGraph();
    graph.addDocument(ROOT, [
      ...describedOrganisation(ROOT, 'Universitetet i Oslo', 'University of Oslo'),
      ...describedOrganisation(FACULTY, 'Fakultetssekretariatet', 'Fakultetssekretariatet'),
      ...symmetricEdge(ROOT, FACULTY),
    ]);

    const [finding] = findingsOfKind(analyse(graph, ROOT), FINDING_KIND.UNTRANSLATED_LABEL);

    assert.deepEqual(finding.subjects, [FACULTY]);
    assert.equal(finding.severity, SEVERITY.NOTE);
  });

  it('shouldNoteMissingLanguageWhenOtherNodesUseIt', () => {
    const graph = new OrganisationGraph();
    graph.addDocument(ROOT, [
      ...describedOrganisation(ROOT, 'Universitetet i Oslo', 'University of Oslo'),
      ...describedOrganisation(FACULTY, 'Det teologiske fakultet'),
      ...symmetricEdge(ROOT, FACULTY),
    ]);

    const [finding] = findingsOfKind(analyse(graph, ROOT), FINDING_KIND.MISSING_LANGUAGE);

    assert.deepEqual(finding.subjects, [FACULTY]);
    assert.deepEqual(finding.detail, { language: 'en' });
  });

  it('shouldFlagConflictingLabelsInSameLanguage', () => {
    const graph = wellFormedUniversity();
    graph.addDocument(FACULTY, [labelQuad(FACULTY, 'nb', 'Teologisk fakultet')]);

    const [finding] = findingsOfKind(analyse(graph, ROOT), FINDING_KIND.CONFLICTING_LABELS);

    assert.equal(finding.severity, SEVERITY.PROBLEM);
    assert.deepEqual(finding.subjects, [FACULTY]);
    assert.equal(finding.detail.language, 'nb');
  });

  it('shouldFlagNodeThatIsOnlyReferencedAndNeverDescribed', () => {
    const graph = new OrganisationGraph();
    graph.addDocument(ROOT, [
      ...describedOrganisation(ROOT, 'Universitetet i Oslo', 'University of Oslo'),
      hasPartQuad(ROOT, FACULTY),
    ]);

    const [finding] = findingsOfKind(analyse(graph, ROOT), FINDING_KIND.UNDESCRIBED);

    assert.deepEqual(finding.subjects, [FACULTY]);
    assert.equal(finding.severity, SEVERITY.WARNING);
  });

  it('shouldFlagMultipleParents', () => {
    const graph = wellFormedUniversity();
    graph.addDocument(OTHER_FACULTY, [
      ...describedOrganisation(OTHER_FACULTY, 'Det juridiske fakultet', 'Faculty of Law'),
      ...symmetricEdge(ROOT, OTHER_FACULTY),
      ...symmetricEdge(OTHER_FACULTY, SECTION),
    ]);

    const [finding] = findingsOfKind(analyse(graph, ROOT), FINDING_KIND.MULTIPLE_PARENTS);

    assert.equal(finding.severity, SEVERITY.PROBLEM);
    assert.deepEqual(finding.subjects, [SECTION]);
    assert.deepEqual([...finding.detail.parents].sort(), [FACULTY, OTHER_FACULTY].sort());
  });

  it('shouldFlagNodesUnreachableFromRoot', () => {
    const graph = wellFormedUniversity();
    graph.addDocument(OTHER_SECTION, [...describedOrganisation(OTHER_SECTION, 'Løsrevet enhet', 'Detached unit')]);

    const [finding] = findingsOfKind(analyse(graph, ROOT), FINDING_KIND.UNREACHABLE);

    assert.deepEqual(finding.subjects, [OTHER_SECTION]);
    assert.equal(finding.severity, SEVERITY.WARNING);
  });

  it('shouldFlagCycles', () => {
    const graph = wellFormedUniversity();
    graph.addDocument(SECTION, [partOfQuad(ROOT, SECTION)]);

    const cycles = findingsOfKind(analyse(graph, ROOT), FINDING_KIND.CYCLE);

    assert.equal(cycles.length, 1);
    assert.equal(cycles[0].severity, SEVERITY.PROBLEM);
    assert.ok(cycles[0].subjects.includes(ROOT));
    assert.ok(cycles[0].subjects.includes(SECTION));
  });

  it('shouldFlagParentThatDoesNotListChildWhichClaimsIt', () => {
    const graph = wellFormedUniversity();
    graph.addDocument(SHADOW_ROOT, [
      ...describedOrganisation(SHADOW_ROOT, 'Universitetet i Oslo', 'University of Oslo'),
      partOfQuad(SHADOW_ROOT, ROOT),
    ]);

    const [finding] = findingsOfKind(analyse(graph, ROOT), FINDING_KIND.PARENT_DOES_NOT_LIST_CHILD);

    assert.equal(finding.severity, SEVERITY.PROBLEM);
    assert.deepEqual(finding.subjects, [SHADOW_ROOT]);
    assert.deepEqual(finding.detail, { parent: ROOT, child: SHADOW_ROOT });
  });

  it('shouldFlagChildWhoseOwnDocumentDoesNotDeclareTheParentThatListsIt', () => {
    const graph = wellFormedUniversity();
    graph.addDocument(SECTION, [...describedOrganisation(SECTION, 'Fakultetssekretariatet', 'Faculty Secretariat')]);

    const [finding] = findingsOfKind(analyse(graph, ROOT), FINDING_KIND.CHILD_DOES_NOT_DECLARE_PARENT);

    assert.equal(finding.severity, SEVERITY.PROBLEM);
    assert.deepEqual(finding.subjects, [SECTION]);
    assert.deepEqual(finding.detail, { parent: FACULTY, child: SECTION });
  });

  it('shouldNotFlagAcknowledgementWhenOnlyEmbeddingDocumentIsLoaded', () => {
    const graph = wellFormedUniversity();

    const findings = analyse(graph, ROOT);

    assert.equal(findingsOfKind(findings, FINDING_KIND.PARENT_DOES_NOT_LIST_CHILD).length, 0);
    assert.equal(findingsOfKind(findings, FINDING_KIND.CHILD_DOES_NOT_DECLARE_PARENT).length, 0);
  });

  it('shouldOrderFindingsBySeverityThenKind', () => {
    const graph = wellFormedUniversity();
    graph.addDocument(OTHER_FACULTY, [
      ...describedOrganisation(OTHER_FACULTY, 'Det teologiske fakultet', 'Det teologiske fakultet'),
      ...symmetricEdge(ROOT, OTHER_FACULTY),
    ]);

    const findings = analyse(graph, ROOT);

    const severities = findings.map((finding) => finding.severity);
    assert.deepEqual(severities, [...severities].sort((left, right) => left - right));
  });
});

describe('worstSeverity', () => {
  it('shouldReturnUndefinedWhenNoFindings', () => {
    assert.equal(worstSeverity([]), undefined);
  });

  it('shouldReturnLowestSeverityNumberAsWorst', () => {
    const findings = [{ severity: SEVERITY.NOTE }, { severity: SEVERITY.PROBLEM }, { severity: SEVERITY.WARNING }];

    assert.equal(worstSeverity(findings), SEVERITY.PROBLEM);
  });
});
