import { TERM_TYPE, XSD_STRING, RDF_LANG_STRING } from './vocabulary.js';

const LITERAL_ESCAPES = Object.freeze([
  ['\\', '\\\\'],
  ['"', '\\"'],
  ['\n', '\\n'],
  ['\r', '\\r'],
]);

const escapeLiteral = (value) =>
  LITERAL_ESCAPES.reduce((escaped, [raw, replacement]) => escaped.replaceAll(raw, replacement), value);

const serialiseLiteral = (literal) => {
  const quoted = `"${escapeLiteral(literal.value)}"`;
  if (literal.language) {
    return `${quoted}@${literal.language}`;
  }
  const datatype = literal.datatype?.value;
  if (!datatype || datatype === XSD_STRING || datatype === RDF_LANG_STRING) {
    return quoted;
  }
  return `${quoted}^^<${datatype}>`;
};

const serialiseTerm = (term) => {
  switch (term.termType) {
    case TERM_TYPE.NAMED_NODE:
      return `<${term.value}>`;
    case TERM_TYPE.BLANK_NODE:
      return `_:${term.value}`;
    case TERM_TYPE.LITERAL:
      return serialiseLiteral(term);
    default:
      throw new Error(`Unsupported term type: ${String(term.termType)}`);
  }
};

/** Serialises one RDF/JS quad as an N-Triples statement without a trailing newline. */
export const serialiseQuad = (quad) =>
  `${serialiseTerm(quad.subject)} ${serialiseTerm(quad.predicate)} ${serialiseTerm(quad.object)} .`;

/** Serialises quads as an N-Triples document; empty input yields an empty string. */
export const serialiseQuads = (quads) => (quads.length === 0 ? '' : `${quads.map(serialiseQuad).join('\n')}\n`);
