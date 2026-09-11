import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OrganisationGraph } from '../src/organisation-graph.js';
import { buildHierarchy } from '../src/hierarchy.js';
import { analyse, SEVERITY, FINDING_KIND } from '../src/findings.js';
import { unitRows, findingRows, describeFindingText, toCsv, UNIT_COLUMNS, FINDING_COLUMNS } from '../src/report.js';
import { iriOf, describedOrganisation, symmetricEdge, typeQuad, hasPartQuad } from './quad-builder.js';

const ROOT = iriOf('185.90.0.0');
const FACULTY = iriOf('185.11.0.0');
const OTHER_FACULTY = iriOf('185.12.0.0');
const SECTION = iriOf('185.11.0.10');

const university = () => {
  const graph = new OrganisationGraph();
  graph.addDocument(ROOT, [
    ...describedOrganisation(ROOT, 'Universitetet i Oslo', 'University of Oslo'),
    ...describedOrganisation(FACULTY, 'Det teologiske fakultet', 'Faculty of Theology'),
    ...describedOrganisation(OTHER_FACULTY, 'Det teologiske fakultet', 'Faculty of Law'),
    ...describedOrganisation(SECTION, 'Sekretariatet', 'Sekretariatet'),
    ...symmetricEdge(ROOT, FACULTY),
    ...symmetricEdge(ROOT, OTHER_FACULTY),
    ...symmetricEdge(FACULTY, SECTION),
  ]);
  return graph;
};

const rowFor = (rows, iri) => rows.find((row) => row.iri === iri);

describe('unitRows', () => {
  it('shouldReturnOneRowPerUnit', () => {
    const graph = university();
    const hierarchy = buildHierarchy(graph, ROOT);

    const rows = unitRows(graph, hierarchy, analyse(graph, ROOT));

    assert.equal(rows.length, 4);
  });

  it('shouldDescribePlaceInHierarchy', () => {
    const graph = university();

    const rows = unitRows(graph, buildHierarchy(graph, ROOT), []);

    const section = rowFor(rows, SECTION);
    assert.equal(section.level, 2);
    assert.equal(section.path, 'Universitetet i Oslo › Det teologiske fakultet');
    assert.equal(section.parentIri, FACULTY);
    assert.equal(rowFor(rows, ROOT).path, '');
  });

  it('shouldCarryLabelsPerLanguageAndStructuralCounts', () => {
    const graph = university();

    const rows = unitRows(graph, buildHierarchy(graph, ROOT), []);

    const faculty = rowFor(rows, FACULTY);
    assert.equal(faculty.labelNb, 'Det teologiske fakultet');
    assert.equal(faculty.labelEn, 'Faculty of Theology');
    assert.equal(faculty.parts, 1);
    assert.equal(faculty.descendants, 1);
  });

  it('shouldCountOwnFindingsBySeverityAndListTheirKinds', () => {
    const graph = university();
    const findings = analyse(graph, ROOT);

    const rows = unitRows(graph, buildHierarchy(graph, ROOT), findings);

    const faculty = rowFor(rows, FACULTY);
    assert.equal(faculty.problems, 1);
    assert.equal(faculty.warnings, 0);
    assert.equal(faculty.notes, 0);
    assert.equal(faculty.kinds, FINDING_KIND.DUPLICATE_SIBLING_LABEL);
    const section = rowFor(rows, SECTION);
    assert.equal(section.notes, 1);
    assert.equal(section.kinds, FINDING_KIND.UNTRANSLATED_LABEL);
  });

  it('shouldLeavePathSegmentEmptyForUndescribedAncestor', () => {
    const graph = new OrganisationGraph();
    graph.addDocument(ROOT, [hasPartQuad(ROOT, FACULTY), ...describedOrganisation(FACULTY, 'Fakultet')]);

    const rows = unitRows(graph, buildHierarchy(graph, ROOT), []);

    assert.equal(rowFor(rows, FACULTY).path, '');
  });

  it('shouldLeaveLabelEmptyWhenLanguageMissing', () => {
    const graph = new OrganisationGraph();
    graph.addDocument(ROOT, [...describedOrganisation(ROOT, 'Bare norsk')]);

    const [row] = unitRows(graph, buildHierarchy(graph, ROOT), []);

    assert.equal(row.labelEn, '');
  });
});

describe('findingRows', () => {
  it('shouldUseIriAsLabelAndEmptyPathForUnitOutsideHierarchy', () => {
    const graph = university();
    const stray = iriOf('185.0.0.0');
    const finding = { kind: FINDING_KIND.UNREACHABLE, severity: SEVERITY.WARNING, subjects: [stray], detail: {} };
    graph.addDocument(stray, [typeQuad(stray)]);

    const [row] = findingRows(graph, buildHierarchy(graph, ROOT), [finding]);

    assert.equal(row.unit, stray);
    assert.equal(row.path, '');
  });

  it('shouldReturnEmptyForNoFindings', () => {
    const graph = university();

    assert.deepEqual(findingRows(graph, buildHierarchy(graph, ROOT), []), []);
  });

  it('shouldProduceOneRowPerSubjectOfEachFinding', () => {
    const graph = university();
    const findings = analyse(graph, ROOT);

    const rows = findingRows(graph, buildHierarchy(graph, ROOT), findings);

    const duplicates = rows.filter((row) => row.kind === FINDING_KIND.DUPLICATE_SIBLING_LABEL);
    assert.equal(duplicates.length, 2);
    assert.deepEqual(duplicates.map((row) => row.iri).sort(), [FACULTY, OTHER_FACULTY].sort());
    assert.equal(duplicates[0].severity, 'Problem');
    assert.equal(duplicates[0].path, 'Universitetet i Oslo');
  });
});

describe('describeFindingText', () => {
  const labelOf = (iri) => ({ [ROOT]: 'Root', [FACULTY]: 'Faculty' })[iri] ?? iri;

  it('shouldReturnEmptyForKindWithoutDetail', () => {
    const finding = { kind: FINDING_KIND.CYCLE, severity: SEVERITY.PROBLEM, subjects: [ROOT], detail: {} };

    assert.equal(describeFindingText(finding, labelOf), '');
  });

  it('shouldNameParentsForMultipleParents', () => {
    const finding = { kind: FINDING_KIND.MULTIPLE_PARENTS, severity: SEVERITY.PROBLEM, subjects: [], detail: { parents: [ROOT, FACULTY] } };

    assert.equal(describeFindingText(finding, labelOf), 'Parents: Root, Faculty');
  });

  it('shouldQuoteLabelAndNameParentForDuplicateSiblings', () => {
    const finding = { kind: FINDING_KIND.DUPLICATE_SIBLING_LABEL, severity: SEVERITY.PROBLEM, subjects: [], detail: { parent: ROOT, language: 'nb', label: 'X' } };

    assert.equal(describeFindingText(finding, labelOf), '"X" (nb) under Root');
  });

  it('shouldListConflictingLabels', () => {
    const finding = { kind: FINDING_KIND.CONFLICTING_LABELS, severity: SEVERITY.PROBLEM, subjects: [], detail: { language: 'nb', labels: ['A', 'B'] } };

    assert.equal(describeFindingText(finding, labelOf), 'nb: "A" versus "B"');
  });

  it('shouldNameBothEndsOfAnUnacknowledgedEdge', () => {
    const finding = { kind: FINDING_KIND.PARENT_DOES_NOT_LIST_CHILD, severity: SEVERITY.PROBLEM, subjects: [], detail: { parent: ROOT, child: FACULTY } };

    assert.equal(describeFindingText(finding, labelOf), 'Parent: Root; unit: Faculty');
  });

  it('shouldNameRegisteredParentForOrphan', () => {
    const finding = { kind: FINDING_KIND.ORPHAN, severity: SEVERITY.PROBLEM, subjects: [], detail: { parent: ROOT } };

    assert.equal(describeFindingText(finding, labelOf), 'Registered with parent Root');
  });

  it('shouldNameBothParentsWhenRegistryDiffers', () => {
    const finding = { kind: FINDING_KIND.REGISTRY_PARENT_DIFFERS, severity: SEVERITY.PROBLEM, subjects: [], detail: { registryParent: ROOT, treeParent: FACULTY } };

    assert.equal(describeFindingText(finding, labelOf), 'Registry: Root; served tree: Faculty');
  });

  it('shouldNameBothEndsWhenChildDoesNotDeclareParent', () => {
    const finding = { kind: FINDING_KIND.CHILD_DOES_NOT_DECLARE_PARENT, severity: SEVERITY.PROBLEM, subjects: [], detail: { parent: ROOT, child: FACULTY } };

    assert.equal(describeFindingText(finding, labelOf), 'Parent: Root; unit: Faculty');
  });

  it('shouldQuoteRepeatedLabel', () => {
    const finding = { kind: FINDING_KIND.REPEATED_LABEL, severity: SEVERITY.NOTE, subjects: [], detail: { language: 'nb', label: 'Arkiv' } };

    assert.equal(describeFindingText(finding, labelOf), '"Arkiv" (nb)');
  });

  it('shouldSayRegisteredWithoutParentForParentlessOrphan', () => {
    const finding = { kind: FINDING_KIND.ORPHAN, severity: SEVERITY.PROBLEM, subjects: [], detail: { parent: undefined } };

    assert.equal(describeFindingText(finding, labelOf), 'Registered without a parent');
  });

  it('shouldNameMissingParentForDanglingParent', () => {
    const finding = { kind: FINDING_KIND.DANGLING_PARENT, severity: SEVERITY.PROBLEM, subjects: [], detail: { parent: ROOT } };

    assert.equal(describeFindingText(finding, labelOf), 'Declared parent does not exist: Root');
  });

  it('shouldNameMissingLanguage', () => {
    const finding = { kind: FINDING_KIND.MISSING_LANGUAGE, severity: SEVERITY.NOTE, subjects: [], detail: { language: 'en' } };

    assert.equal(describeFindingText(finding, labelOf), 'Missing language: en');
  });
});

describe('toCsv', () => {
  const columns = [
    { key: 'name', heading: 'Name' },
    { key: 'count', heading: 'Count' },
  ];

  it('shouldEmitHeaderOnlyForNoRows', () => {
    assert.equal(toCsv([], columns), 'Name,Count\r\n');
  });

  it('shouldQuoteFieldsContainingDelimitersQuotesOrLineBreaks', () => {
    const rows = [{ name: 'a,b', count: 1 }, { name: 'say "hi"', count: 2 }, { name: 'two\nlines', count: 3 }];

    const csv = toCsv(rows, columns);

    assert.equal(csv, 'Name,Count\r\n"a,b",1\r\n"say ""hi""",2\r\n"two\nlines",3\r\n');
  });

  it('shouldWriteUndefinedAsEmptyField', () => {
    assert.equal(toCsv([{ name: undefined, count: 0 }], columns), 'Name,Count\r\n,0\r\n');
  });

  it('shouldExposeColumnDefinitionsForBothTables', () => {
    assert.ok(UNIT_COLUMNS.some((column) => column.key === 'iri'));
    assert.ok(FINDING_COLUMNS.some((column) => column.key === 'description'));
  });
});
