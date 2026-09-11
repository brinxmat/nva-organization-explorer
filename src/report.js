import { FINDING_KIND, SEVERITY, findingsAbout } from './findings.js';
import { displayLabel } from './hierarchy.js';

const DEFAULT_LANGUAGE = 'nb';
const PATH_SEPARATOR = ' › ';
const LIST_SEPARATOR = ', ';
const CSV_DELIMITER = ',';
const CSV_LINE_END = '\r\n';
const CSV_QUOTE = '"';
const CSV_ESCAPED_QUOTE = '""';
const CHARACTERS_REQUIRING_QUOTES = /[",\r\n]/;

export const SEVERITY_TEXT = Object.freeze({
  [SEVERITY.PROBLEM]: 'Problem',
  [SEVERITY.WARNING]: 'Warning',
  [SEVERITY.NOTE]: 'Note',
});

export const UNIT_COLUMNS = Object.freeze([
  { key: 'path', heading: 'Path' },
  { key: 'labelNb', heading: 'Label (nb)' },
  { key: 'labelEn', heading: 'Label (en)' },
  { key: 'level', heading: 'Level', numeric: true },
  { key: 'parts', heading: 'Parts', numeric: true },
  { key: 'descendants', heading: 'Descendants', numeric: true },
  { key: 'problems', heading: 'Problems', numeric: true },
  { key: 'warnings', heading: 'Warnings', numeric: true },
  { key: 'notes', heading: 'Notes', numeric: true },
  { key: 'kinds', heading: 'Finding kinds' },
  { key: 'iri', heading: 'IRI' },
  { key: 'parentIri', heading: 'Parent IRI' },
]);

export const FINDING_COLUMNS = Object.freeze([
  { key: 'severity', heading: 'Severity' },
  { key: 'kind', heading: 'Kind' },
  { key: 'unit', heading: 'Unit' },
  { key: 'path', heading: 'Path' },
  { key: 'description', heading: 'Description' },
  { key: 'iri', heading: 'IRI' },
]);

const labelIn = (node, language) => (node.labels.has(language) ? [...node.labels.get(language)].sort().join(' / ') : '');

const firstPositions = (hierarchyRoot) => {
  const positions = new Map();
  const visit = (hierarchyNode, ancestors) => {
    if (!positions.has(hierarchyNode.iri)) {
      positions.set(hierarchyNode.iri, { hierarchyNode, ancestors });
    }
    hierarchyNode.children.forEach((child) => visit(child, [...ancestors, hierarchyNode.iri]));
  };
  visit(hierarchyRoot, []);
  return positions;
};

const pathText = (graph, ancestors, language) =>
  ancestors.map((ancestor) => displayLabel(graph.node(ancestor), language) ?? '').join(PATH_SEPARATOR);

const countWithSeverity = (findings, severity) => findings.filter((item) => item.severity === severity).length;

/**
 * One row per unit reachable from the hierarchy root, in hierarchy order. A unit reachable by
 * several paths is reported once, at the first path encountered.
 */
export const unitRows = (graph, hierarchyRoot, findings, language = DEFAULT_LANGUAGE) =>
  [...firstPositions(hierarchyRoot).values()].map(({ hierarchyNode, ancestors }) => {
    const node = graph.node(hierarchyNode.iri);
    const own = findingsAbout(findings, hierarchyNode.iri);
    return Object.freeze({
      iri: hierarchyNode.iri,
      level: hierarchyNode.depth,
      path: pathText(graph, ancestors, language),
      parentIri: ancestors.at(-1) ?? '',
      labelNb: labelIn(node, 'nb'),
      labelEn: labelIn(node, 'en'),
      parts: node.children.size,
      descendants: hierarchyNode.descendantCount,
      problems: countWithSeverity(own, SEVERITY.PROBLEM),
      warnings: countWithSeverity(own, SEVERITY.WARNING),
      notes: countWithSeverity(own, SEVERITY.NOTE),
      kinds: [...new Set(own.map((item) => item.kind))].join(LIST_SEPARATOR),
    });
  });

const quoted = (text) => `${CSV_QUOTE}${text}${CSV_QUOTE}`;

/** Plain-text description of a finding's detail, for tables and CSV. Empty when there is none. */
export const describeFindingText = (finding, labelOf) => {
  const { kind, detail } = finding;
  switch (kind) {
    case FINDING_KIND.MULTIPLE_PARENTS:
      return `Parents: ${detail.parents.map(labelOf).join(LIST_SEPARATOR)}`;
    case FINDING_KIND.PARENT_DOES_NOT_LIST_CHILD:
    case FINDING_KIND.CHILD_DOES_NOT_DECLARE_PARENT:
      return `Parent: ${labelOf(detail.parent)}; unit: ${labelOf(detail.child)}`;
    case FINDING_KIND.DUPLICATE_SIBLING_LABEL:
      return `${quoted(detail.label)} (${detail.language}) under ${labelOf(detail.parent)}`;
    case FINDING_KIND.CONFLICTING_LABELS:
      return `${detail.language}: ${detail.labels.map(quoted).join(' versus ')}`;
    case FINDING_KIND.REPEATED_LABEL:
      return `${quoted(detail.label)} (${detail.language})`;
    case FINDING_KIND.MISSING_LANGUAGE:
      return `Missing language: ${detail.language}`;
    case FINDING_KIND.ORPHAN:
      return detail.parent ? `Registered with parent ${labelOf(detail.parent)}` : 'Registered without a parent';
    case FINDING_KIND.DANGLING_PARENT:
      return `Declared parent does not exist: ${labelOf(detail.parent)}`;
    case FINDING_KIND.REGISTRY_PARENT_DIFFERS:
      return `Registry: ${labelOf(detail.registryParent)}; served tree: ${labelOf(detail.treeParent)}`;
    default:
      return '';
  }
};

/** One row per finding subject, most severe first, with the subject's place in the hierarchy. */
export const findingRows = (graph, hierarchyRoot, findings, language = DEFAULT_LANGUAGE) => {
  const positions = firstPositions(hierarchyRoot);
  const labelOf = (iri) => displayLabel(graph.node(iri), language) ?? iri;
  return findings.flatMap((finding) =>
    finding.subjects.map((iri) =>
      Object.freeze({
        severity: SEVERITY_TEXT[finding.severity],
        kind: finding.kind,
        unit: labelOf(iri),
        path: pathText(graph, positions.get(iri)?.ancestors ?? [], language),
        description: describeFindingText(finding, labelOf),
        iri,
      }),
    ),
  );
};

const csvField = (value) => {
  const text = value === undefined || value === null ? '' : String(value);
  return CHARACTERS_REQUIRING_QUOTES.test(text) ? quoted(text.replaceAll(CSV_QUOTE, CSV_ESCAPED_QUOTE)) : text;
};

/** RFC 4180 CSV with a header row and CRLF line endings. */
export const toCsv = (rows, columns) =>
  [columns.map((column) => csvField(column.heading)), ...rows.map((row) => columns.map((column) => csvField(row[column.key])))]
    .map((fields) => fields.join(CSV_DELIMITER))
    .map((line) => `${line}${CSV_LINE_END}`)
    .join('');
