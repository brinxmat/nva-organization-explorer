import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OrganisationGraph } from '../src/organisation-graph.js';
import {
  iriOf,
  describedOrganisation,
  symmetricEdge,
  hasPartQuad,
  partOfQuad,
  labelQuad,
  countryQuad,
} from './quad-builder.js';

const ROOT = iriOf('185.90.0.0');
const FACULTY = iriOf('185.11.0.0');
const SECTION = iriOf('185.11.0.10');

describe('OrganisationGraph', () => {
  it('shouldReturnUndefinedForUnknownNode', () => {
    const graph = new OrganisationGraph();

    const node = graph.node(iriOf('999.0.0.0'));

    assert.equal(node, undefined);
  });

  it('shouldRejectDocumentWithoutIri', () => {
    const graph = new OrganisationGraph();

    assert.throws(() => graph.addDocument('', []), /document IRI/);
  });

  it('shouldIgnoreBlankNodeSubjects', () => {
    const graph = new OrganisationGraph();
    const blankSubjectQuad = {
      subject: { termType: 'BlankNode', value: 'b0' },
      predicate: { termType: 'NamedNode', value: 'https://nva.sikt.no/ontology/publication#label' },
      object: { termType: 'Literal', value: 'x', language: 'nb' },
    };

    graph.addDocument(ROOT, [blankSubjectQuad]);

    assert.equal(graph.nodeCount, 0);
  });

  it('shouldMergeStatementsAboutSameIriFromSeveralDocuments', () => {
    const graph = new OrganisationGraph();

    graph.addDocument(ROOT, [...describedOrganisation(ROOT, 'Universitetet i Oslo', 'University of Oslo')]);
    graph.addDocument(FACULTY, [labelQuad(ROOT, 'en', 'University of Oslo'), countryQuad(ROOT, 'NO')]);

    const root = graph.node(ROOT);
    assert.deepEqual([...root.labels.get('en')], ['University of Oslo']);
    assert.deepEqual([...root.countries], ['NO']);
    assert.equal(graph.nodeCount, 1);
  });

  it('shouldKeepConflictingLabelsInSameLanguageSideBySide', () => {
    const graph = new OrganisationGraph();

    graph.addDocument(ROOT, [labelQuad(FACULTY, 'nb', 'Det teologiske fakultet')]);
    graph.addDocument(FACULTY, [labelQuad(FACULTY, 'nb', 'Teologisk fakultet')]);

    assert.deepEqual([...graph.node(FACULTY).labels.get('nb')].sort(), [
      'Det teologiske fakultet',
      'Teologisk fakultet',
    ]);
  });

  it('shouldDeriveParentAndChildFromEitherDirectionOfTheRelation', () => {
    const graph = new OrganisationGraph();

    graph.addDocument(ROOT, [hasPartQuad(ROOT, FACULTY), partOfQuad(SECTION, FACULTY)]);

    assert.deepEqual([...graph.node(ROOT).children], [FACULTY]);
    assert.deepEqual([...graph.node(FACULTY).parents], [ROOT]);
    assert.deepEqual([...graph.node(FACULTY).children], [SECTION]);
    assert.deepEqual([...graph.node(SECTION).parents], [FACULTY]);
  });

  it('shouldRecordWhichDocumentAssertedEachDirectionOfAnEdge', () => {
    const graph = new OrganisationGraph();

    graph.addDocument(ROOT, [hasPartQuad(ROOT, FACULTY)]);
    graph.addDocument(FACULTY, [partOfQuad(FACULTY, ROOT)]);

    assert.equal(graph.documentAssertsHasPart(ROOT, ROOT, FACULTY), true);
    assert.equal(graph.documentAssertsPartOf(ROOT, FACULTY, ROOT), false);
    assert.equal(graph.documentAssertsPartOf(FACULTY, FACULTY, ROOT), true);
    assert.equal(graph.documentAssertsHasPart(FACULTY, ROOT, FACULTY), false);
  });

  it('shouldRecordAssertionEvenWhenAnotherDocumentAlreadyStatedTheSameTriple', () => {
    const graph = new OrganisationGraph();

    graph.addDocument(ROOT, [hasPartQuad(ROOT, FACULTY), partOfQuad(FACULTY, ROOT)]);
    graph.addDocument(FACULTY, [partOfQuad(FACULTY, ROOT)]);

    assert.equal(graph.documentAssertsPartOf(FACULTY, FACULTY, ROOT), true);
    assert.equal(graph.quadCount, 2);
  });

  it('shouldListEveryDocumentThatAssertedATriple', () => {
    const graph = new OrganisationGraph();

    graph.addDocument(ROOT, [partOfQuad(FACULTY, ROOT)]);
    graph.addDocument(FACULTY, [partOfQuad(FACULTY, ROOT)]);

    const [quad] = graph.quadsAbout(FACULTY);
    assert.deepEqual([...quad.sources].sort(), [FACULTY, ROOT].sort());
  });

  it('shouldFileLabelWithoutLanguageUnderEmptyLanguage', () => {
    const graph = new OrganisationGraph();
    const plainLabel = {
      subject: { termType: 'NamedNode', value: ROOT },
      predicate: { termType: 'NamedNode', value: 'https://nva.sikt.no/ontology/publication#label' },
      object: { termType: 'Literal', value: 'UiO', language: '', datatype: { termType: 'NamedNode', value: 'http://www.w3.org/2001/XMLSchema#string' } },
    };

    graph.addDocument(ROOT, [plainLabel]);

    assert.deepEqual([...graph.node(ROOT).labels.get('')], ['UiO']);
  });

  it('shouldAnswerFalseForAssertionsOfUnknownDocument', () => {
    const graph = new OrganisationGraph();

    assert.equal(graph.documentAssertsHasPart(FACULTY, ROOT, FACULTY), false);
    assert.equal(graph.documentAssertsPartOf(FACULTY, FACULTY, ROOT), false);
  });

  it('shouldReportLoadedDocuments', () => {
    const graph = new OrganisationGraph();

    graph.addDocument(ROOT, []);

    assert.equal(graph.hasDocument(ROOT), true);
    assert.equal(graph.hasDocument(FACULTY), false);
    assert.deepEqual([...graph.documentIris()], [ROOT]);
  });

  it('shouldReturnQuadsWhereIriIsSubjectOrObject', () => {
    const graph = new OrganisationGraph();
    graph.addDocument(ROOT, [...symmetricEdge(ROOT, FACULTY), labelQuad(SECTION, 'nb', 'Seksjon')]);

    const quadsAboutFaculty = graph.quadsAbout(FACULTY);

    assert.equal(quadsAboutFaculty.length, 2);
    assert.ok(quadsAboutFaculty.every((quad) => quad.sources.has(ROOT)));
  });

  it('shouldNotStoreDuplicateQuadsFromTheSameDocument', () => {
    const graph = new OrganisationGraph();

    graph.addDocument(ROOT, [hasPartQuad(ROOT, FACULTY), hasPartQuad(ROOT, FACULTY)]);

    assert.equal(graph.quadCount, 1);
  });

  it('shouldReturnCopyOfAllQuads', () => {
    const graph = new OrganisationGraph();
    graph.addDocument(ROOT, [hasPartQuad(ROOT, FACULTY)]);

    const quads = graph.allQuads();
    quads.pop();

    assert.equal(graph.quadCount, 1);
  });

  it('shouldListAllEdgesAsParentChildPairs', () => {
    const graph = new OrganisationGraph();
    graph.addDocument(ROOT, [hasPartQuad(ROOT, FACULTY), partOfQuad(FACULTY, ROOT), partOfQuad(SECTION, FACULTY)]);

    const edges = graph.edges();

    assert.deepEqual(
      edges.map((edge) => [edge.parent, edge.child]).sort(),
      [
        [FACULTY, SECTION],
        [ROOT, FACULTY],
      ],
    );
  });
});
