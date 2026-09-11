import { OrganisationGraph } from './organisation-graph.js';
import { analyse, compareFindings, findingsAbout, subtreeFindingCounts, worstSeverity, FINDING_KIND, SEVERITY } from './findings.js';
import { compareRegistry, institutionNumberOf, nextPageUrl, registryPageUrl, registryQuadsFor, registryUnits } from './registry.js';
import { AUDIT_CATEGORY, AUDIT_CATEGORY_TEXT, AUDIT_COLUMNS, classify, parseIriList } from './audit.js';
import { buildHierarchy, displayLabel, pathToRoot } from './hierarchy.js';
import { serialiseQuads } from './ntriples.js';
import { jsonOnlyPropertiesById, unmappedKeys } from './json-inspection.js';
import { fitChart, renderChart } from './chart.js';
import { FINDING_COLUMNS, SEVERITY_TEXT, UNIT_COLUMNS, findingRows, toCsv, unitRows } from './report.js';

const API = Object.freeze({
  ORGANISATION_BASE: 'https://api.nva.unit.no/cristin/organization',
  SEARCH_RESULT_COUNT: 20,
  DEPTH_PARAMETER: 'depth',
  DEPTH_TOP: 'top',
  ACCEPT: 'application/ld+json, application/json',
  DEPTH_NONE: 'none',
});
const ORGANISATION_IRI_PREFIX = `${API.ORGANISATION_BASE}/`;

const HASH_KEY = Object.freeze({ ORGANISATION: 'org', NODE: 'node', LANGUAGE: 'lang' });
const DEFAULT_LANGUAGE = 'nb';
const VERIFICATION_CONCURRENCY = 4;
const INITIAL_EXPANSION_DEPTH = 1;
const DOWNLOAD_FILE_NAME = 'organisations.nt';
const N_TRIPLES_MEDIA_TYPE = 'application/n-triples';
const UNLABELLED = '(no label)';
const TAB = Object.freeze({ NODE: 'node', FINDINGS: 'findings', REPORT: 'report', AUDIT: 'audit', DATA: 'data' });
const AUDIT_CSV_FILE_NAME = 'organisation-audit.csv';
const REPORT_TABLE = Object.freeze({ UNITS: 'units', FINDINGS: 'findings' });
const CSV_MEDIA_TYPE = 'text/csv';
const CSV_FILE_NAMES = Object.freeze({ [REPORT_TABLE.UNITS]: 'organisation-units.csv', [REPORT_TABLE.FINDINGS]: 'organisation-findings.csv' });
const BUBBLE_SEVERITIES = Object.freeze([SEVERITY.PROBLEM, SEVERITY.WARNING]);

const FINDING_TEXT = Object.freeze({
  [FINDING_KIND.CYCLE]: {
    title: 'Cycle in the hierarchy',
    rule: 'Following part-of relations from a unit leads back to the same unit.',
  },
  [FINDING_KIND.MULTIPLE_PARENTS]: {
    title: 'More than one parent',
    rule: 'The unit is declared part of several parents, so it has no single place in the chart.',
  },
  [FINDING_KIND.PARENT_DOES_NOT_LIST_CHILD]: {
    title: 'Parent does not list this unit',
    rule: 'The unit says it is part of a parent, but the parent, when asked directly, does not list the unit among its parts.',
  },
  [FINDING_KIND.CHILD_DOES_NOT_DECLARE_PARENT]: {
    title: 'Unit does not declare its parent',
    rule: 'A parent lists the unit among its parts, but the unit, when asked directly, does not say it is part of that parent.',
  },
  [FINDING_KIND.DUPLICATE_SIBLING_LABEL]: {
    title: 'Siblings with the same name',
    rule: 'Two or more units under the same parent carry the same label in the same language.',
  },
  [FINDING_KIND.CONFLICTING_LABELS]: {
    title: 'Conflicting labels',
    rule: 'Different documents give the unit different labels in the same language.',
  },
  [FINDING_KIND.ORPHAN]: {
    title: 'Registered, but not in the served tree',
    rule: 'Cristin lists the unit under this institution, but the tree served for the root never reaches it.',
  },
  [FINDING_KIND.DANGLING_PARENT]: {
    title: 'Declared parent does not exist',
    rule: 'The registry says the unit is part of a parent that is neither registered nor in the served tree.',
  },
  [FINDING_KIND.REGISTRY_PARENT_DIFFERS]: {
    title: 'Registry and tree disagree about the parent',
    rule: 'Cristin’s flat list and the served tree place the unit under different parents.',
  },
  [FINDING_KIND.NOT_IN_REGISTRY]: {
    title: 'In the tree, but not registered under the institution',
    rule: 'The served tree contains the unit, but Cristin does not list it under this institution. It may belong to another institution.',
  },
  [FINDING_KIND.UNDESCRIBED]: {
    title: 'Referenced but never described',
    rule: 'The unit is mentioned as a part or a parent, but no loaded document says anything about it. Dereference it to learn more.',
  },
  [FINDING_KIND.UNREACHABLE]: {
    title: 'Not connected to the root',
    rule: 'No chain of part-of relations connects the unit to the organisation you opened.',
  },
  [FINDING_KIND.REPEATED_LABEL]: {
    title: 'Same name used elsewhere',
    rule: 'Units in different places carry the same label. Often legitimate, but confusing to people and worth a look.',
  },
  [FINDING_KIND.UNTRANSLATED_LABEL]: {
    title: 'Same text in both languages',
    rule: 'The Norwegian and English labels are identical, so one of them is probably not a translation.',
  },
  [FINDING_KIND.MISSING_LANGUAGE]: {
    title: 'Label missing in a language',
    rule: 'Other units in this organisation carry a label in this language; this one does not.',
  },
});

const state = {
  rootIri: undefined,
  graph: new OrganisationGraph(),
  findings: [],
  hierarchy: undefined,
  subtreeCounts: new Map(),
  selectedIri: undefined,
  language: DEFAULT_LANGUAGE,
  expanded: new Set(),
  jsonOnlyProperties: new Map(),
  unmappedJsonKeys: new Set(),
  contextIri: undefined,
  activeTab: TAB.NODE,
  verificationFailures: [],
  report: { table: REPORT_TABLE.UNITS, sortKey: undefined, sortDescending: false, filterText: '', onlyWithFindings: false },
  rootTreeParents: new Map(),
  registry: { loaded: false, loading: false, institutionNumber: undefined, units: [], pages: 0 },
  registryFindings: [],
  audit: { text: '', rows: [], rejected: [], running: false },
};

const registryIris = () => new Set(state.registry.units.map((unit) => unit.iri));

const byId = (id) => document.getElementById(id);

const element = (tag, attributes = {}, children = []) => {
  const node = document.createElement(tag);
  Object.entries(attributes).forEach(([name, value]) => {
    if (name === 'text') {
      node.textContent = value;
    } else if (name === 'class') {
      node.className = value;
    } else if (name.startsWith('on')) {
      node.addEventListener(name.slice(2), value);
    } else if (value !== undefined && value !== null && value !== false) {
      node.setAttribute(name, value);
    }
  });
  children.filter(Boolean).forEach((child) => node.append(child));
  return node;
};

const replaceChildren = (container, ...children) => container.replaceChildren(...children.filter(Boolean));

const setStatus = (message, isError = false) => {
  const status = byId('status');
  status.textContent = message;
  status.className = isError ? 'status error' : 'status';
};

const isApiIri = (iri) => iri.startsWith(API.ORGANISATION_BASE);

const labelOf = (iri) => {
  const node = state.graph.node(iri);
  return (node && displayLabel(node, state.language)) ?? UNLABELLED;
};

const severityOf = (iri) => worstSeverity(findingsAbout(state.findings, iri));

const bubblesOf = (iri) => {
  const counts = state.subtreeCounts.get(iri);
  return counts
    ? BUBBLE_SEVERITIES.map((severity) => ({ severity, count: counts[severity] })).filter(({ count }) => count > 0)
    : [];
};

const bubbleTitle = ({ severity, count }) => `${count} ${SEVERITY_TEXT[severity].toLowerCase()}${count === 1 ? '' : 's'} below this unit`;

const nodeLink = (iri) =>
  element('button', { class: 'link', type: 'button', text: labelOf(iri), title: iri, onclick: () => selectNode(iri) });

const externalLink = (iri) =>
  isApiIri(iri)
    ? element('a', { href: iri, target: '_blank', rel: 'noopener noreferrer', class: 'iri', text: iri })
    : element('span', { class: 'iri', text: iri });

const contextCache = new Map();

const fetchJson = async (url) => {
  const response = await fetch(url, { headers: { Accept: API.ACCEPT } });
  if (!response.ok) {
    throw new Error(`The API answered ${response.status} for the requested organisation`);
  }
  return response.json();
};

const fetchWithStatus = async (url) => {
  const response = await fetch(url, { headers: { Accept: API.ACCEPT } });
  return { status: response.status, json: response.ok ? await response.json() : undefined, headers: response.headers };
};

const documentLoader = async (url) => {
  if (!contextCache.has(url)) {
    contextCache.set(url, fetchJson(url));
  }
  return { contextUrl: null, documentUrl: url, document: await contextCache.get(url) };
};

const contextTermsOf = async (jsonDocument) => {
  const context = jsonDocument['@context'];
  const contextObject = typeof context === 'string' ? (await documentLoader(context)).document['@context'] : context;
  return new Set(Object.keys(contextObject ?? {}));
};

const toQuads = (jsonDocument) => globalThis.jsonld.toRDF(jsonDocument, { documentLoader });

const mergeJsonOnlyProperties = (properties) =>
  properties.forEach((values, iri) =>
    state.jsonOnlyProperties.set(iri, { ...(state.jsonOnlyProperties.get(iri) ?? {}), ...values }),
  );

const ingestDocument = async (documentIri, jsonDocument) => {
  const terms = await contextTermsOf(jsonDocument);
  const quads = await toQuads(jsonDocument);
  state.graph.addDocument(documentIri, quads);
  mergeJsonOnlyProperties(jsonOnlyPropertiesById(jsonDocument, terms));
  unmappedKeys(jsonDocument, terms).forEach((key) => state.unmappedJsonKeys.add(key));
  state.contextIri = typeof jsonDocument['@context'] === 'string' ? jsonDocument['@context'] : state.contextIri;
};

const recompute = () => {
  state.findings = [...analyse(state.graph, state.rootIri), ...state.registryFindings].sort(compareFindings);
  state.hierarchy = buildHierarchy(state.graph, state.rootIri, state.language);
  state.subtreeCounts = subtreeFindingCounts(state.hierarchy, state.findings);
};

const irisToDepth = (hierarchyNode, depth) =>
  depth < 0 ? [] : [hierarchyNode.iri, ...hierarchyNode.children.flatMap((child) => irisToDepth(child, depth - 1))];

const allIrisWithChildren = (hierarchyNode) =>
  hierarchyNode.children.length === 0
    ? []
    : [hierarchyNode.iri, ...hierarchyNode.children.flatMap(allIrisWithChildren)];

const resetForNewOrganisation = (rootIri) => {
  state.rootIri = rootIri;
  state.graph = new OrganisationGraph();
  state.findings = [];
  state.jsonOnlyProperties = new Map();
  state.unmappedJsonKeys = new Set();
  state.verificationFailures = [];
  state.expanded = new Set();
  state.selectedIri = rootIri;
  state.rootTreeParents = new Map();
  state.registry = { loaded: false, loading: false, institutionNumber: undefined, units: [], pages: 0 };
  state.registryFindings = [];
  state.audit = { text: '', rows: [], rejected: [], running: false };
};

const treeParents = (hierarchyNode, parentIri, parents = new Map()) => {
  if (!parents.has(hierarchyNode.iri)) {
    parents.set(hierarchyNode.iri, parentIri);
    hierarchyNode.children.forEach((child) => treeParents(child, hierarchyNode.iri, parents));
  }
  return parents;
};

const loadOrganisation = async (requestedIri, preselectedIri) => {
  setStatus('Loading organisation…');
  try {
    const jsonDocument = await fetchJson(requestedIri);
    const rootIri = typeof jsonDocument.id === 'string' ? jsonDocument.id : requestedIri;
    resetForNewOrganisation(rootIri);
    await ingestDocument(rootIri, jsonDocument);
    recompute();
    state.rootTreeParents = treeParents(state.hierarchy, undefined);
    state.expanded = new Set(irisToDepth(state.hierarchy, INITIAL_EXPANSION_DEPTH - 1));
    state.selectedIri = preselectedIri && state.graph.node(preselectedIri) ? preselectedIri : rootIri;
    expandPathTo(state.selectedIri);
    byId('workspace').hidden = false;
    byId('welcome').hidden = true;
    byId('download-button').disabled = false;
    setStatus(`Loaded ${state.graph.nodeCount} organisations from one document.`);
    renderAll();
    requestAnimationFrame(() => fitChart(byId('chart-svg')));
  } catch (error) {
    setStatus(error.message, true);
  }
};

const verificationUrl = (iri) => {
  const url = new URL(iri);
  url.searchParams.set(API.DEPTH_PARAMETER, API.DEPTH_TOP);
  return url.toString();
};

const dereference = async (iri) => {
  const jsonDocument = await fetchJson(verificationUrl(iri));
  await ingestDocument(iri, jsonDocument);
};

const dereferenceSelected = async () => {
  const iri = state.selectedIri;
  setStatus('Dereferencing the unit’s own document…');
  try {
    await dereference(iri);
    recompute();
    setStatus(`Merged the unit’s own document. ${state.graph.quadCount} statements loaded.`);
    renderAll();
  } catch (error) {
    setStatus(error.message, true);
  }
};

const descendantIris = (iri) => {
  const reached = new Set();
  const frontier = [iri];
  while (frontier.length > 0) {
    const current = frontier.pop();
    if (!reached.has(current)) {
      reached.add(current);
      frontier.push(...state.graph.node(current).children);
    }
  }
  return [...reached];
};

const unverifiedDescendants = (iri) => descendantIris(iri).filter((candidate) => !state.graph.hasDocument(candidate));

const runWithConcurrency = async (items, limit, work) => {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      await work(queue.shift());
    }
  });
  await Promise.all(runners);
};

const verifySubtree = async () => {
  const targets = unverifiedDescendants(state.selectedIri);
  const total = targets.length;
  let completed = 0;
  const failures = [];
  await runWithConcurrency(targets, VERIFICATION_CONCURRENCY, async (iri) => {
    try {
      await dereference(iri);
    } catch (error) {
      failures.push({ iri, message: error.message });
    }
    completed += 1;
    setStatus(`Verifying: ${completed} of ${total} documents fetched, ${failures.length} failed.`);
  });
  state.verificationFailures = [...state.verificationFailures, ...failures];
  recompute();
  renderAll();
  setStatus(`Verification finished: ${total - failures.length} documents merged, ${failures.length} failed.`, failures.length > 0);
};

const expandPathTo = (iri) => pathToRoot(state.graph, iri).forEach((ancestor) => state.expanded.add(ancestor));

const selectNode = (iri, { showUnitTab = true } = {}) => {
  state.selectedIri = iri;
  state.activeTab = showUnitTab ? TAB.NODE : state.activeTab;
  expandPathTo(iri);
  renderAll();
  byId('structure-tree').querySelector('.tree-row.selected')?.scrollIntoView({ block: 'nearest' });
};

const toggleExpanded = (iri) => {
  if (state.expanded.has(iri)) {
    state.expanded.delete(iri);
  } else {
    state.expanded.add(iri);
  }
  renderStructure();
  renderChartPanel();
};

const renderTreeNode = (hierarchyNode, pathIris) => {
  const { iri, children, descendantCount, truncatedCycle } = hierarchyNode;
  const isExpanded = state.expanded.has(iri) && children.length > 0;
  const severity = severityOf(iri);
  const row = element(
    'div',
    {
      class: ['tree-row', iri === state.selectedIri && 'selected', pathIris.has(iri) && 'on-path'].filter(Boolean).join(' '),
    },
    [
      element('button', {
        class: `toggle${children.length === 0 ? ' leaf' : ''}`,
        type: 'button',
        'aria-label': isExpanded ? 'Collapse' : 'Expand',
        text: isExpanded ? '▾' : '▸',
        onclick: () => toggleExpanded(iri),
      }),
      severity === undefined ? null : element('span', { class: `dot severity-${severity}`, title: SEVERITY_TEXT[severity] }),
      element('button', { class: 'tree-label', type: 'button', text: labelOf(iri), title: iri, onclick: () => selectNode(iri) }),
      truncatedCycle ? element('span', { class: 'badge cycle', text: 'cycle' }) : null,
      ...bubblesOf(iri).map((bubble) =>
        element('span', { class: `bubble severity-${bubble.severity}`, title: bubbleTitle(bubble), text: String(bubble.count) }),
      ),
      children.length > 0 ? element('span', { class: 'badge', text: String(descendantCount) }) : null,
    ],
  );
  const childList = isExpanded ? element('ul', {}, children.map((child) => renderTreeNode(child, pathIris))) : null;
  return element('li', {}, [row, childList]);
};

const renderStructure = () => {
  const pathIris = new Set(pathToRoot(state.graph, state.selectedIri));
  replaceChildren(byId('structure-tree'), element('ul', {}, [renderTreeNode(state.hierarchy, pathIris)]));
};

const renderChartPanel = () => {
  renderChart(byId('chart-svg'), state.hierarchy, {
    expanded: state.expanded,
    selectedIri: state.selectedIri,
    pathIris: new Set(pathToRoot(state.graph, state.selectedIri)),
    labelOf,
    severityOf,
    bubblesOf,
    onSelect: selectNode,
    onToggle: toggleExpanded,
  });
};

const keyValueTable = (rows) =>
  element(
    'table',
    { class: 'kv' },
    rows.map(([key, value]) => element('tr', {}, [element('th', { text: key }), element('td', {}, [value])])),
  );

const textOrNodes = (value) => (typeof value === 'string' ? document.createTextNode(value) : value);

const nodeList = (iris) =>
  element(
    'ul',
    { class: 'plain' },
    iris.map((iri) => element('li', {}, [nodeLink(iri)])),
  );

const describeFinding = (finding) => {
  const { kind, detail } = finding;
  switch (kind) {
    case FINDING_KIND.MULTIPLE_PARENTS:
      return element('span', {}, ['Parents: ', ...detail.parents.flatMap((parent, index) => [index > 0 ? ', ' : null, nodeLink(parent)])]);
    case FINDING_KIND.PARENT_DOES_NOT_LIST_CHILD:
    case FINDING_KIND.CHILD_DOES_NOT_DECLARE_PARENT:
      return element('span', {}, ['Parent: ', nodeLink(detail.parent), ' · Unit: ', nodeLink(detail.child)]);
    case FINDING_KIND.DUPLICATE_SIBLING_LABEL:
      return element('span', {}, [
        element('q', { text: detail.label }),
        ` (${detail.language}) under `,
        nodeLink(detail.parent),
      ]);
    case FINDING_KIND.CONFLICTING_LABELS:
      return element('span', {}, [
        `${detail.language}: `,
        ...detail.labels.flatMap((label, index) => [index > 0 ? ' versus ' : null, element('q', { text: label })]),
      ]);
    case FINDING_KIND.REPEATED_LABEL:
      return element('span', {}, [element('q', { text: detail.label }), ` (${detail.language})`]);
    case FINDING_KIND.MISSING_LANGUAGE:
      return element('span', { text: `Missing language: ${detail.language}` });
    case FINDING_KIND.ORPHAN:
      return detail.parent ? element('span', {}, ['Registered with parent ', nodeLink(detail.parent)]) : element('span', { text: 'Registered without a parent' });
    case FINDING_KIND.DANGLING_PARENT:
      return element('span', {}, ['Declared parent: ', externalLink(detail.parent)]);
    case FINDING_KIND.REGISTRY_PARENT_DIFFERS:
      return element('span', {}, ['Registry: ', nodeLink(detail.registryParent), ' · served tree: ', nodeLink(detail.treeParent)]);
    default:
      return null;
  }
};

const findingCard = (finding, includeSubjects) =>
  element('div', { class: `finding severity-${finding.severity}` }, [
    element('div', { class: 'kind', text: `${SEVERITY_TEXT[finding.severity]}: ${FINDING_TEXT[finding.kind].title}` }),
    element('p', {}, [describeFinding(finding)]),
    includeSubjects
      ? element('div', { class: 'subjects' }, finding.subjects.map(nodeLink))
      : null,
  ]);

const labelsTable = (node) =>
  keyValueTable(
    [...node.labels.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([language, labels]) => [language || '(no language)', textOrNodes([...labels].join(' · '))]),
  );

const jsonOnlySection = (iri) => {
  const properties = state.jsonOnlyProperties.get(iri);
  if (!properties) {
    return null;
  }
  return element('div', {}, [
    element('h3', { text: 'In the JSON but not in the graph' }),
    element('p', { class: 'muted', text: 'These fields are not mapped by the JSON-LD context, so they vanish when the document is read as RDF.' }),
    keyValueTable(Object.entries(properties).map(([key, value]) => [key, textOrNodes(String(value))])),
  ]);
};

const provenanceSection = (iri) => {
  const sources = new Set(state.graph.quadsAbout(iri).flatMap((quad) => [...quad.sources]));
  const ownDocumentLoaded = state.graph.hasDocument(iri);
  const verifiable = unverifiedDescendants(iri).length;
  return element('div', {}, [
    element('h3', { text: 'Where this comes from' }),
    element('p', {}, [
      ownDocumentLoaded
        ? 'This unit’s own document has been read. '
        : 'Everything known about this unit comes from other documents. ',
      `Statements about it come from ${sources.size} document${sources.size === 1 ? '' : 's'}.`,
    ]),
    element('div', { class: 'actions' }, [
      element('button', {
        type: 'button',
        text: 'Dereference this unit',
        disabled: ownDocumentLoaded,
        title: 'Fetch the unit’s own document and compare it with what its parent says',
        onclick: dereferenceSelected,
      }),
      element('button', {
        type: 'button',
        text: `Verify subtree (${verifiable} document${verifiable === 1 ? '' : 's'})`,
        disabled: verifiable === 0,
        title: 'Fetch every unit below this one and check that parents and children agree',
        onclick: verifySubtree,
      }),
    ]),
  ]);
};

const loadRegistry = async () => {
  let institutionNumber;
  try {
    institutionNumber = institutionNumberOf(state.rootIri);
  } catch (error) {
    setStatus(error.message, true);
    return;
  }
  state.registry = { ...state.registry, loading: true, institutionNumber };
  renderFindingsTab();
  try {
    const units = [];
    let pages = 0;
    let url = registryPageUrl(institutionNumber, 1);
    while (url) {
      const { status, json, headers } = await fetchWithStatus(url);
      if (!json) {
        throw new Error(`Cristin answered ${status} for the unit listing`);
      }
      units.push(...registryUnits(json, ORGANISATION_IRI_PREFIX));
      pages += 1;
      setStatus(`Reading Cristin’s unit list: ${units.length} units after ${pages} page${pages === 1 ? '' : 's'}…`);
      url = nextPageUrl(headers.get('Link'));
    }
    state.registry = { loaded: true, loading: false, institutionNumber, units, pages };
    state.registryFindings = compareRegistry(units, state.rootTreeParents);
    const orphanIris = new Set(
      state.registryFindings.filter((finding) => finding.kind === FINDING_KIND.ORPHAN).flatMap((finding) => finding.subjects),
    );
    state.graph.addDocument(registryPageUrl(institutionNumber, 1), registryQuadsFor(units.filter((unit) => orphanIris.has(unit.iri))));
    recompute();
    renderAll();
    setStatus(`Compared ${units.length} registered units with ${state.rootTreeParents.size} units in the served tree: ${orphanIris.size} orphan${orphanIris.size === 1 ? '' : 's'}.`);
  } catch (error) {
    state.registry = { ...state.registry, loading: false };
    renderFindingsTab();
    setStatus(error.message, true);
  }
};

const registryControls = () => {
  const { loaded, loading, units, pages } = state.registry;
  return element('div', { class: 'actions' }, [
    element('button', {
      type: 'button',
      text: loaded ? 'Compare with Cristin’s unit list again' : 'Compare with Cristin’s unit list',
      title: 'Read every unit Cristin registers under this institution and compare with the served tree',
      disabled: loading,
      onclick: loadRegistry,
    }),
    loaded
      ? element('span', { class: 'muted', text: `${units.length} registered units read in ${pages} page${pages === 1 ? '' : 's'}.` })
      : element('span', { class: 'muted', text: 'Orphans can only be found against Cristin’s flat list of units for the institution.' }),
  ]);
};

const topOfAncestorChain = (jsonDocument) => {
  let current = jsonDocument;
  const seen = new Set();
  while (current && typeof current.id === 'string' && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = current.partOf?.[0];
    if (!parent) {
      return current.id;
    }
    current = parent;
  }
  return undefined;
};

const auditUnit = async (iri) => {
  const url = new URL(iri);
  url.searchParams.set(API.DEPTH_PARAMETER, API.DEPTH_NONE);
  const { status, json } = await fetchWithStatus(url.toString());
  const declaredParent = json?.partOf?.[0];
  const topOfChain = topOfAncestorChain(json);
  const inTree = state.rootTreeParents.has(iri);
  const inRegistry = state.registry.loaded ? registryIris().has(iri) : undefined;
  return Object.freeze({
    iri,
    category: classify({
      httpStatus: status,
      inTree,
      inRegistry,
      registryLoaded: state.registry.loaded,
      underLoadedRoot: topOfChain === undefined ? undefined : topOfChain === state.rootIri,
    }),
    httpStatus: status,
    label: json?.labels?.[state.language] ?? Object.values(json?.labels ?? {})[0] ?? '',
    declaredParent: typeof declaredParent?.id === 'string' ? declaredParent.id : '',
    declaredParentLabel: declaredParent?.labels?.[state.language] ?? Object.values(declaredParent?.labels ?? {})[0] ?? '',
    inTree: inTree ? 'yes' : 'no',
    inRegistry: inRegistry === undefined ? 'unknown' : inRegistry ? 'yes' : 'no',
  });
};

const runAudit = async () => {
  const { iris, rejected } = parseIriList(state.audit.text, ORGANISATION_IRI_PREFIX);
  state.audit = { ...state.audit, rows: [], rejected, running: true };
  renderAuditTab();
  const rows = [];
  await runWithConcurrency(iris, VERIFICATION_CONCURRENCY, async (iri) => {
    try {
      rows.push(await auditUnit(iri));
    } catch {
      rows.push(Object.freeze({ iri, category: AUDIT_CATEGORY.ERROR, httpStatus: 0, label: '', declaredParent: '', declaredParentLabel: '', inTree: 'unknown', inRegistry: 'unknown' }));
    }
    setStatus(`Auditing: ${rows.length} of ${iris.length} IRIs checked.`);
  });
  state.audit = { ...state.audit, rows: [...rows].sort((left, right) => left.category.localeCompare(right.category) || left.iri.localeCompare(right.iri)), running: false };
  renderAuditTab();
  setStatus(`Audit finished: ${rows.length} IRIs checked, ${rejected.length} entries could not be read as IRIs.`, rejected.length > 0);
};

const auditRowText = (row, column) =>
  column.key === 'category' ? AUDIT_CATEGORY_TEXT[row.category] : String(row[column.key] ?? '');

const auditTable = (rows) =>
  element('div', { class: 'table-scroll' }, [
    element('table', { class: 'report' }, [
      element('thead', {}, [element('tr', {}, AUDIT_COLUMNS.map((column) => element('th', { scope: 'col', class: column.numeric ? 'numeric' : '', text: column.heading })))]),
      element('tbody', {}, rows.map((row) =>
        element('tr', { onclick: () => (state.graph.node(row.iri) ? selectNode(row.iri, { showUnitTab: false }) : undefined) },
          AUDIT_COLUMNS.map((column) =>
            element('td', { class: [column.numeric && 'numeric', column.key === 'iri' && 'iri', column.key === 'category' && `category-${row.category}`].filter(Boolean).join(' '), text: auditRowText(row, column) }),
          ),
        ),
      )),
    ]),
  ]);

const categoryCounts = (rows) =>
  Object.values(AUDIT_CATEGORY)
    .map((category) => ({ category, count: rows.filter((row) => row.category === category).length }))
    .filter(({ count }) => count > 0);

const renderAuditTab = () => {
  const { text, rows, rejected, running } = state.audit;
  replaceChildren(
    byId('tab-audit'),
    element('h3', { text: 'Check a list of organisation IRIs' }),
    element('p', { class: 'muted', text: 'Paste IRIs or bare identifiers from your own data, one per line or separated by commas. Each is dereferenced and placed in exactly one category. Load Cristin’s unit list first to tell orphans from ghosts.' }),
    element('textarea', { class: 'audit-input', placeholder: `${ORGANISATION_IRI_PREFIX}185.0.0.0`, oninput: (event) => { state.audit.text = event.target.value; } }, [document.createTextNode(text)]),
    element('div', { class: 'actions' }, [
      element('button', { type: 'button', text: running ? 'Checking…' : 'Check', disabled: running, onclick: runAudit }),
      rows.length > 0
        ? element('button', { type: 'button', text: 'Download CSV', onclick: () => downloadText(toCsv(rows.map((row) => ({ ...row, category: AUDIT_CATEGORY_TEXT[row.category] })), AUDIT_COLUMNS), CSV_MEDIA_TYPE, AUDIT_CSV_FILE_NAME) })
        : null,
    ]),
    rejected.length > 0
      ? element('div', { class: 'notice' }, [element('strong', { text: `${rejected.length} entr${rejected.length === 1 ? 'y' : 'ies'} could not be read as organisation IRIs: ` }), document.createTextNode(rejected.join(', '))])
      : null,
    rows.length > 0
      ? element('div', { class: 'category-counts' }, categoryCounts(rows).map(({ category, count }) => element('span', { text: `${AUDIT_CATEGORY_TEXT[category]}: ${count}` })))
      : null,
    rows.length > 0 ? auditTable(rows) : null,
  );
};

const renderNodeTab = () => {
  const iri = state.selectedIri;
  const node = state.graph.node(iri);
  const path = pathToRoot(state.graph, iri);
  const ownFindings = findingsAbout(state.findings, iri);
  replaceChildren(
    byId('tab-node'),
    element('h2', { class: 'unit-title', text: labelOf(iri) }),
    externalLink(iri),
    element('h3', { text: 'Place in the organisation' }),
    element(
      'div',
      { class: 'breadcrumb' },
      path.flatMap((ancestor, index) => [
        index > 0 ? element('span', { class: 'separator', text: '›' }) : null,
        ancestor === iri ? element('strong', { text: labelOf(ancestor) }) : nodeLink(ancestor),
      ]),
    ),
    element('h3', { text: 'Labels' }),
    node.labels.size === 0 ? element('p', { class: 'muted', text: 'No labels are asserted for this unit.' }) : labelsTable(node),
    jsonOnlySection(iri),
    element('h3', { text: `Parents (${node.parents.size})` }),
    node.parents.size === 0 ? element('p', { class: 'muted', text: 'None. This is a root.' }) : nodeList([...node.parents]),
    element('h3', { text: `Parts (${node.children.size})` }),
    node.children.size === 0 ? element('p', { class: 'muted', text: 'None.' }) : nodeList([...node.children].sort((left, right) => labelOf(left).localeCompare(labelOf(right), state.language))),
    element('h3', { text: `Findings (${ownFindings.length})` }),
    ownFindings.length === 0
      ? element('p', { class: 'muted', text: 'Nothing to report for this unit.' })
      : element('div', {}, ownFindings.map((finding) => findingCard(finding, false))),
    provenanceSection(iri),
    element('h3', { text: 'Statements about this unit' }),
    element('pre', { text: serialiseQuads(state.graph.quadsAbout(iri)) || '(none)' }),
  );
};

const groupFindingsByKind = (findings) =>
  findings.reduce((groups, finding) => {
    groups.set(finding.kind, [...(groups.get(finding.kind) ?? []), finding]);
    return groups;
  }, new Map());

const renderFindingsTab = () => {
  const groups = groupFindingsByKind(state.findings);
  const counts = Object.values(SEVERITY).map(
    (severity) => `${state.findings.filter((finding) => finding.severity === severity).length} ${SEVERITY_TEXT[severity].toLowerCase()}s`,
  );
  byId('findings-count').textContent = String(state.findings.length);
  replaceChildren(
    byId('tab-findings'),
    element('p', { class: 'muted', text: counts.join(' · ') }),
    element('p', { class: 'muted', text: 'Parent and child agreement can only be checked for units whose own document has been read. Use “Verify subtree” on a unit to read them.' }),
    registryControls(),
    ...(groups.size === 0 ? [element('p', { text: 'Nothing to report.' })] : []),
    ...[...groups.entries()].map(([kind, findings]) =>
      element('details', { class: 'group', open: findings[0].severity === SEVERITY.PROBLEM }, [
        element('summary', {}, [
          element('span', { class: `dot severity-${findings[0].severity}` }),
          element('strong', { text: FINDING_TEXT[kind].title }),
          element('span', { class: 'count', text: String(findings.length) }),
        ]),
        element('div', { class: 'body' }, [
          element('p', { class: 'explanation', text: FINDING_TEXT[kind].rule }),
          ...findings.map((finding) => findingCard(finding, true)),
        ]),
      ]),
    ),
  );
};

const depthDistribution = (hierarchyNode) =>
  [hierarchyNode, ...hierarchyNode.children.flatMap((child) => flatten(child))].reduce((counts, node) => {
    counts.set(node.depth, (counts.get(node.depth) ?? 0) + 1);
    return counts;
  }, new Map());

const flatten = (hierarchyNode) => [hierarchyNode, ...hierarchyNode.children.flatMap(flatten)];

const renderDataTab = () => {
  const depths = depthDistribution(state.hierarchy);
  const languages = [...new Set([...state.graph.nodes()].flatMap((node) => [...node.labels.keys()]))].sort();
  replaceChildren(
    byId('tab-data'),
    element('h3', { text: 'Graph' }),
    keyValueTable([
      ['Root', externalLink(state.rootIri)],
      ['Documents read', textOrNodes(String([...state.graph.documentIris()].length))],
      ['Organisations', textOrNodes(String(state.graph.nodeCount))],
      ['Statements', textOrNodes(String(state.graph.quadCount))],
      ['Label languages', textOrNodes(languages.join(', ') || '(none)')],
      ['Cristin unit list', textOrNodes(state.registry.loaded ? `${state.registry.units.length} units for institution ${state.registry.institutionNumber}` : 'not read')],
      ['JSON-LD context', state.contextIri ? element('a', { href: state.contextIri, target: '_blank', rel: 'noopener noreferrer', class: 'iri', text: state.contextIri }) : textOrNodes('(inline)')],
    ]),
    element('h3', { text: 'Units per level' }),
    keyValueTable([...depths.entries()].sort(([left], [right]) => left - right).map(([depth, count]) => [`Level ${depth}`, textOrNodes(String(count))])),
    state.unmappedJsonKeys.size === 0
      ? null
      : element('div', { class: 'notice' }, [
          element('strong', { text: 'Fields the context does not map: ' }),
          document.createTextNode([...state.unmappedJsonKeys].sort().join(', ')),
          element('p', { class: 'muted', text: 'These exist in the JSON but are not part of the RDF. Anything relying on them is relying on the serialisation, not on the data model.' }),
        ]),
    state.verificationFailures.length === 0
      ? null
      : element('div', { class: 'notice' }, [
          element('strong', { text: `Documents that could not be read (${state.verificationFailures.length})` }),
          element('ul', { class: 'plain' }, state.verificationFailures.map(({ iri, message }) => element('li', {}, [externalLink(iri), document.createTextNode(` — ${message}`)]))),
        ]),
    element('h3', { text: 'Reading this data as RDF' }),
    element('p', { text: 'Each API response is a JSON-LD document. It is expanded with its published context and turned into triples, and the triples from every document read are merged into one graph keyed by IRI. The chart follows the part-of relation in that graph. Nothing is derived from the shape of the identifiers.' }),
  );
};

const renderTabs = () => {
  document.querySelectorAll('.tabs [role="tab"]').forEach((tab) => {
    const isActive = tab.dataset.tab === state.activeTab;
    tab.setAttribute('aria-selected', String(isActive));
  });
  Object.values(TAB).forEach((tab) => {
    byId(`tab-${tab}`).hidden = tab !== state.activeTab;
  });
};

const updateHash = () => {
  const parameters = new URLSearchParams({
    [HASH_KEY.ORGANISATION]: state.rootIri,
    [HASH_KEY.NODE]: state.selectedIri,
    [HASH_KEY.LANGUAGE]: state.language,
  });
  history.replaceState(null, '', `#${parameters.toString()}`);
};

const renderAll = () => {
  renderStructure();
  renderChartPanel();
  renderNodeTab();
  renderFindingsTab();
  renderReportTab();
  renderAuditTab();
  renderDataTab();
  renderTabs();
  updateHash();
};

const downloadText = (text, mediaType, fileName) => {
  const url = URL.createObjectURL(new Blob([text], { type: mediaType }));
  element('a', { href: url, download: fileName }).click();
  URL.revokeObjectURL(url);
};

const downloadGraph = () => downloadText(serialiseQuads(state.graph.allQuads()), N_TRIPLES_MEDIA_TYPE, DOWNLOAD_FILE_NAME);

const reportRows = () =>
  state.report.table === REPORT_TABLE.UNITS
    ? unitRows(state.graph, state.hierarchy, state.findings, state.language)
    : findingRows(state.graph, state.hierarchy, state.findings, state.language);

const reportColumns = () => (state.report.table === REPORT_TABLE.UNITS ? UNIT_COLUMNS : FINDING_COLUMNS);

const hasFindings = (row) => row.problems + row.warnings + row.notes > 0;

const matchesFilter = (row, columns, needle) =>
  needle === '' || columns.some((column) => String(row[column.key] ?? '').toLowerCase().includes(needle));

const compareRows = (column, descending) => (left, right) => {
  const leftValue = left[column.key] ?? '';
  const rightValue = right[column.key] ?? '';
  const order = column.numeric ? Number(leftValue) - Number(rightValue) : String(leftValue).localeCompare(String(rightValue), state.language);
  return descending ? -order : order;
};

const visibleReportRows = () => {
  const columns = reportColumns();
  const needle = state.report.filterText.trim().toLowerCase();
  const sortColumn = columns.find((column) => column.key === state.report.sortKey);
  const filtered = reportRows()
    .filter((row) => state.report.table !== REPORT_TABLE.UNITS || !state.report.onlyWithFindings || hasFindings(row))
    .filter((row) => matchesFilter(row, columns, needle));
  return sortColumn ? [...filtered].sort(compareRows(sortColumn, state.report.sortDescending)) : filtered;
};

const downloadReport = () =>
  downloadText(toCsv(visibleReportRows(), reportColumns()), CSV_MEDIA_TYPE, CSV_FILE_NAMES[state.report.table]);

const sortReportBy = (key) => {
  state.report.sortDescending = state.report.sortKey === key ? !state.report.sortDescending : false;
  state.report.sortKey = key;
  renderReportTab();
};

const ariaSortFor = (column) =>
  column.key !== state.report.sortKey ? 'none' : state.report.sortDescending ? 'descending' : 'ascending';

const cellClass = (column, row) =>
  [column.numeric && 'numeric', column.key === 'iri' && 'iri', ['path', 'description', 'kinds'].includes(column.key) && 'wrap', column.key === 'severity' && `severity-${row.severity}`]
    .filter(Boolean)
    .join(' ');

const reportTable = (rows, columns) =>
  element('table', { class: 'report' }, [
    element('thead', {}, [
      element('tr', {}, columns.map((column) =>
        element('th', { scope: 'col', class: column.numeric ? 'numeric' : '', 'aria-sort': ariaSortFor(column), onclick: () => sortReportBy(column.key), text: column.heading }),
      )),
    ]),
    element('tbody', {}, rows.map((row) =>
      element('tr', { class: row.iri === state.selectedIri ? 'selected' : '', onclick: () => selectNode(row.iri, { showUnitTab: false }) },
        columns.map((column) => element('td', { class: cellClass(column, row), text: String(row[column.key] ?? '') })),
      ),
    )),
  ]);

const renderReportTab = () => {
  const rows = visibleReportRows();
  const isUnits = state.report.table === REPORT_TABLE.UNITS;
  const tableChoice = (value, label) =>
    element('label', {}, [
      element('input', { type: 'radio', name: 'report-table', value, checked: state.report.table === value, onchange: () => { state.report.table = value; state.report.sortKey = undefined; renderReportTab(); } }),
      document.createTextNode(` ${label}`),
    ]);
  replaceChildren(
    byId('tab-report'),
    element('div', { class: 'report-controls' }, [
      tableChoice(REPORT_TABLE.UNITS, 'Units'),
      tableChoice(REPORT_TABLE.FINDINGS, 'Findings'),
      element('input', { type: 'search', placeholder: 'Filter rows', value: state.report.filterText, oninput: (event) => { state.report.filterText = event.target.value; renderReportTab(); } }),
      isUnits
        ? element('label', {}, [
            element('input', { type: 'checkbox', checked: state.report.onlyWithFindings, onchange: (event) => { state.report.onlyWithFindings = event.target.checked; renderReportTab(); } }),
            document.createTextNode(' Only units with findings'),
          ])
        : null,
      element('button', { type: 'button', text: 'Download CSV', title: 'Download the rows currently shown', onclick: downloadReport }),
    ]),
    element('p', { class: 'report-summary', text: `${rows.length} row${rows.length === 1 ? '' : 's'}. Click a heading to sort, a row to select the unit.` }),
    element('div', { class: 'table-scroll' }, [reportTable(rows, reportColumns())]),
  );
};

const searchUrl = (query) => {
  const url = new URL(API.ORGANISATION_BASE);
  url.searchParams.set('query', query);
  url.searchParams.set('results', String(API.SEARCH_RESULT_COUNT));
  return url.toString();
};

const renderSearchResults = (hits) => {
  const list = byId('search-results');
  replaceChildren(
    list,
    ...(hits.length === 0 ? [element('li', { class: 'muted', text: 'No organisations matched.' })] : []),
    ...hits.map((hit) =>
      element('li', {}, [
        element(
          'button',
          {
            type: 'button',
            onclick: () => {
              list.hidden = true;
              loadOrganisation(hit.id);
            },
          },
          [
            document.createTextNode(hit.labels?.[state.language] ?? Object.values(hit.labels ?? {})[0] ?? UNLABELLED),
            element('span', { class: 'iri', text: hit.id }),
          ],
        ),
      ]),
    ),
  );
  list.hidden = false;
};

const looksLikeIri = (text) => /^https?:\/\//.test(text);

const onSearch = async (event) => {
  event.preventDefault();
  const query = byId('search-input').value.trim();
  if (looksLikeIri(query)) {
    byId('search-results').hidden = true;
    await loadOrganisation(query);
    return;
  }
  setStatus('Searching…');
  try {
    const result = await fetchJson(searchUrl(query));
    const hits = Array.isArray(result.hits) ? result.hits.filter((hit) => typeof hit.id === 'string') : [];
    setStatus(`${hits.length} organisation${hits.length === 1 ? '' : 's'} matched.`);
    renderSearchResults(hits);
  } catch (error) {
    setStatus(error.message, true);
  }
};

const readHash = () => new URLSearchParams(location.hash.replace(/^#/, ''));

const applyHash = () => {
  const parameters = readHash();
  const organisation = parameters.get(HASH_KEY.ORGANISATION);
  const language = parameters.get(HASH_KEY.LANGUAGE);
  if (language) {
    state.language = language;
    byId('language-select').value = language;
  }
  if (organisation && isApiIri(organisation)) {
    byId('search-input').value = organisation;
    loadOrganisation(organisation, parameters.get(HASH_KEY.NODE) ?? undefined);
  }
};

const wireControls = () => {
  byId('search-form').addEventListener('submit', onSearch);
  document.addEventListener('click', (event) => {
    if (!byId('search-form').contains(event.target)) {
      byId('search-results').hidden = true;
    }
  });
  byId('language-select').addEventListener('change', (event) => {
    state.language = event.target.value;
    if (state.rootIri) {
      recompute();
      renderAll();
    }
  });
  byId('download-button').addEventListener('click', downloadGraph);
  byId('expand-all-button').addEventListener('click', () => {
    state.expanded = new Set(allIrisWithChildren(state.hierarchy));
    renderStructure();
    renderChartPanel();
  });
  byId('collapse-all-button').addEventListener('click', () => {
    state.expanded = new Set(irisToDepth(state.hierarchy, INITIAL_EXPANSION_DEPTH - 1));
    expandPathTo(state.selectedIri);
    renderStructure();
    renderChartPanel();
    requestAnimationFrame(() => fitChart(byId('chart-svg')));
  });
  byId('fit-chart-button').addEventListener('click', () => fitChart(byId('chart-svg')));
  document.querySelectorAll('.tabs [role="tab"]').forEach((tab) =>
    tab.addEventListener('click', () => {
      state.activeTab = tab.dataset.tab;
      renderTabs();
    }),
  );
  window.addEventListener('hashchange', () => {
    const parameters = readHash();
    const organisation = parameters.get(HASH_KEY.ORGANISATION);
    const node = parameters.get(HASH_KEY.NODE);
    if (organisation && organisation !== state.rootIri) {
      applyHash();
    } else if (node && node !== state.selectedIri && state.graph.node(node)) {
      selectNode(node);
    }
  });
};

wireControls();
applyHash();
