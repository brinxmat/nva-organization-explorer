import { PREDICATE, ORGANISATION_TYPE, TERM_TYPE, RDF_LANG_STRING, XSD_STRING } from '../src/vocabulary.js';

export const ORGANISATION_BASE = 'https://api.nva.unit.no/cristin/organization/';

export const iriOf = (identifier) => `${ORGANISATION_BASE}${identifier}`;

const namedNode = (value) => ({ termType: TERM_TYPE.NAMED_NODE, value });

const languageLiteral = (value, language) => ({
  termType: TERM_TYPE.LITERAL,
  value,
  language,
  datatype: namedNode(RDF_LANG_STRING),
});

const plainLiteral = (value) => ({
  termType: TERM_TYPE.LITERAL,
  value,
  language: '',
  datatype: namedNode(XSD_STRING),
});

const quad = (subject, predicate, object) => ({
  subject: namedNode(subject),
  predicate: namedNode(predicate),
  object,
});

export const typeQuad = (subject) => quad(subject, PREDICATE.TYPE, namedNode(ORGANISATION_TYPE));

export const labelQuad = (subject, language, label) =>
  quad(subject, PREDICATE.LABEL, languageLiteral(label, language));

export const countryQuad = (subject, country) => quad(subject, PREDICATE.COUNTRY, plainLiteral(country));

export const hasPartQuad = (parent, child) => quad(parent, PREDICATE.HAS_PART, namedNode(child));

export const partOfQuad = (child, parent) => quad(child, PREDICATE.PART_OF, namedNode(parent));

export const describedOrganisation = (iri, norwegianLabel, englishLabel) => [
  typeQuad(iri),
  labelQuad(iri, 'nb', norwegianLabel),
  ...(englishLabel ? [labelQuad(iri, 'en', englishLabel)] : []),
];

export const symmetricEdge = (parent, child) => [hasPartQuad(parent, child), partOfQuad(child, parent)];
