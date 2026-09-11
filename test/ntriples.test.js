import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { serialiseQuad, serialiseQuads } from '../src/ntriples.js';
import { iriOf, hasPartQuad, labelQuad, countryQuad } from './quad-builder.js';

const ROOT = iriOf('185.90.0.0');
const FACULTY = iriOf('185.11.0.0');

describe('serialiseQuad', () => {
  it('shouldThrowOnUnknownObjectTermType', () => {
    const quad = { ...hasPartQuad(ROOT, FACULTY), object: { termType: 'Variable', value: 'x' } };

    assert.throws(() => serialiseQuad(quad), /term type/);
  });

  it('shouldSerialiseIriObject', () => {
    assert.equal(
      serialiseQuad(hasPartQuad(ROOT, FACULTY)),
      `<${ROOT}> <https://nva.sikt.no/ontology/publication#hasPart> <${FACULTY}> .`,
    );
  });

  it('shouldSerialiseLanguageTaggedLiteral', () => {
    assert.equal(
      serialiseQuad(labelQuad(ROOT, 'nb', 'Universitetet i Oslo')),
      `<${ROOT}> <https://nva.sikt.no/ontology/publication#label> "Universitetet i Oslo"@nb .`,
    );
  });

  it('shouldOmitDatatypeForPlainStringLiteral', () => {
    assert.equal(
      serialiseQuad(countryQuad(ROOT, 'NO')),
      `<${ROOT}> <https://nva.sikt.no/ontology/publication#country> "NO" .`,
    );
  });

  it('shouldEscapeQuotesBackslashesAndLineBreaksInLiterals', () => {
    const serialised = serialiseQuad(labelQuad(ROOT, 'nb', 'Sier "hei"\\\n'));

    assert.ok(serialised.includes('"Sier \\"hei\\"\\\\\\n"@nb'));
  });

  it('shouldAppendDatatypeForTypedLiteral', () => {
    const quad = {
      subject: { termType: 'NamedNode', value: ROOT },
      predicate: { termType: 'NamedNode', value: 'https://example.org/count' },
      object: { termType: 'Literal', value: '3', language: '', datatype: { termType: 'NamedNode', value: 'http://www.w3.org/2001/XMLSchema#integer' } },
    };

    assert.equal(serialiseQuad(quad), `<${ROOT}> <https://example.org/count> "3"^^<http://www.w3.org/2001/XMLSchema#integer> .`);
  });

  it('shouldTreatLiteralWithoutDatatypeAsPlainString', () => {
    const quad = {
      subject: { termType: 'NamedNode', value: ROOT },
      predicate: { termType: 'NamedNode', value: 'https://example.org/note' },
      object: { termType: 'Literal', value: 'x' },
    };

    assert.equal(serialiseQuad(quad), `<${ROOT}> <https://example.org/note> "x" .`);
  });

  it('shouldSerialiseBlankNodes', () => {
    const quad = {
      subject: { termType: 'BlankNode', value: 'b0' },
      predicate: { termType: 'NamedNode', value: 'https://example.org/p' },
      object: { termType: 'BlankNode', value: 'b1' },
    };

    assert.equal(serialiseQuad(quad), '_:b0 <https://example.org/p> _:b1 .');
  });
});

describe('serialiseQuads', () => {
  it('shouldReturnEmptyStringForNoQuads', () => {
    assert.equal(serialiseQuads([]), '');
  });

  it('shouldJoinWithNewlineAndTerminateWithNewline', () => {
    const serialised = serialiseQuads([hasPartQuad(ROOT, FACULTY), countryQuad(ROOT, 'NO')]);

    assert.equal(serialised.split('\n').length, 3);
    assert.ok(serialised.endsWith('\n'));
  });
});
