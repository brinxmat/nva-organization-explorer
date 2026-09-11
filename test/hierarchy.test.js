import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OrganisationGraph } from '../src/organisation-graph.js';
import { buildHierarchy, displayLabel, pathToRoot } from '../src/hierarchy.js';
import { iriOf, describedOrganisation, symmetricEdge, partOfQuad, hasPartQuad, labelQuad } from './quad-builder.js';

const ROOT = iriOf('185.90.0.0');
const FACULTY = iriOf('185.11.0.0');
const SECTION = iriOf('185.11.0.10');
const OTHER_FACULTY = iriOf('185.12.0.0');

const university = () => {
  const graph = new OrganisationGraph();
  graph.addDocument(ROOT, [
    ...describedOrganisation(ROOT, 'Universitetet i Oslo', 'University of Oslo'),
    ...describedOrganisation(FACULTY, 'Det teologiske fakultet', 'Faculty of Theology'),
    ...describedOrganisation(OTHER_FACULTY, 'Det juridiske fakultet', 'Faculty of Law'),
    ...describedOrganisation(SECTION, 'Fakultetssekretariatet', 'Faculty Secretariat'),
    ...symmetricEdge(ROOT, FACULTY),
    ...symmetricEdge(ROOT, OTHER_FACULTY),
    ...symmetricEdge(FACULTY, SECTION),
  ]);
  return graph;
};

describe('buildHierarchy', () => {
  it('shouldThrowWhenRootUnknown', () => {
    const graph = new OrganisationGraph();

    assert.throws(() => buildHierarchy(graph, ROOT), /root/);
  });

  it('shouldNestChildrenUnderParentsWithDepth', () => {
    const hierarchy = buildHierarchy(university(), ROOT);

    assert.equal(hierarchy.iri, ROOT);
    assert.equal(hierarchy.depth, 0);
    assert.equal(hierarchy.children.length, 2);
    const theology = hierarchy.children.find((child) => child.iri === FACULTY);
    assert.equal(theology.depth, 1);
    assert.deepEqual(
      theology.children.map((child) => child.iri),
      [SECTION],
    );
  });

  it('shouldSortSiblingsByLabelInRequestedLanguage', () => {
    const hierarchy = buildHierarchy(university(), ROOT, 'en');

    assert.deepEqual(
      hierarchy.children.map((child) => child.iri),
      [OTHER_FACULTY, FACULTY],
    );
  });

  it('shouldCountDescendants', () => {
    const hierarchy = buildHierarchy(university(), ROOT);

    assert.equal(hierarchy.descendantCount, 3);
  });

  it('shouldStopAtCyclesInsteadOfRecursingForever', () => {
    const graph = university();
    graph.addDocument(SECTION, [partOfQuad(ROOT, SECTION)]);

    const hierarchy = buildHierarchy(graph, ROOT);

    const section = hierarchy.children.find((child) => child.iri === FACULTY).children[0];
    const [repeatedRoot] = section.children;
    assert.equal(repeatedRoot.iri, ROOT);
    assert.equal(repeatedRoot.truncatedCycle, true);
    assert.equal(repeatedRoot.children.length, 0);
  });
});

describe('displayLabel', () => {
  it('shouldReturnUndefinedForUndescribedNode', () => {
    const graph = university();
    graph.addDocument(ROOT, [partOfQuad(iriOf('185.0.0.0'), ROOT)]);

    assert.equal(displayLabel(graph.node(iriOf('185.0.0.0'))), undefined);
  });

  it('shouldFallBackToAnyLanguageWhenPreferredOnesAreMissing', () => {
    const graph = new OrganisationGraph();
    graph.addDocument(ROOT, [labelQuad(ROOT, 'de', 'Universität Oslo')]);

    assert.equal(displayLabel(graph.node(ROOT), 'nb'), 'Universität Oslo');
  });

  it('shouldSortSeveralUndescribedSiblingsWithoutFailing', () => {
    const graph = university();
    graph.addDocument(ROOT, [hasPartQuad(ROOT, iriOf('185.0.0.0')), hasPartQuad(ROOT, iriOf('185.1.0.0'))]);

    const hierarchy = buildHierarchy(graph, ROOT, 'nb');

    assert.equal(hierarchy.children.length, 4);
  });

  it('shouldSortUndescribedSiblingsFirstWithoutFailing', () => {
    const graph = university();
    graph.addDocument(ROOT, [hasPartQuad(ROOT, iriOf('185.0.0.0'))]);

    const hierarchy = buildHierarchy(graph, ROOT, 'nb');

    assert.equal(hierarchy.children[0].iri, iriOf('185.0.0.0'));
  });
});

describe('pathToRoot', () => {
  it('shouldReturnOnlyNodeItselfWhenItHasNoParents', () => {
    assert.deepEqual(pathToRoot(university(), ROOT), [ROOT]);
  });

  it('shouldReturnAncestorsFromRootDownToNode', () => {
    assert.deepEqual(pathToRoot(university(), SECTION), [ROOT, FACULTY, SECTION]);
  });

  it('shouldReturnEmptyForUnknownNode', () => {
    assert.deepEqual(pathToRoot(university(), iriOf('999.0.0.0')), []);
  });

  it('shouldTerminateOnCycle', () => {
    const graph = university();
    graph.addDocument(SECTION, [partOfQuad(ROOT, SECTION)]);

    const path = pathToRoot(graph, SECTION);

    assert.ok(path.length <= 3);
    assert.equal(path.at(-1), SECTION);
  });
});
