export const PUBLICATION_ONTOLOGY = 'https://nva.sikt.no/ontology/publication#';

export const PREDICATE = Object.freeze({
  TYPE: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
  LABEL: `${PUBLICATION_ONTOLOGY}label`,
  PART_OF: `${PUBLICATION_ONTOLOGY}partOf`,
  HAS_PART: `${PUBLICATION_ONTOLOGY}hasPart`,
  COUNTRY: `${PUBLICATION_ONTOLOGY}country`,
});

export const ORGANISATION_TYPE = `${PUBLICATION_ONTOLOGY}Organization`;

export const TERM_TYPE = Object.freeze({
  NAMED_NODE: 'NamedNode',
  BLANK_NODE: 'BlankNode',
  LITERAL: 'Literal',
});

export const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
export const RDF_LANG_STRING = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString';
