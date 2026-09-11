const DEFAULT_LANGUAGE = 'nb';

const LANGUAGE_PREFERENCE = Object.freeze(['nb', 'en', 'nn', '']);

/**
 * Chooses one display label for a node: the requested language first, then the usual
 * fallbacks, then whatever language exists. Returns undefined for undescribed nodes.
 */
export const displayLabel = (node, language = DEFAULT_LANGUAGE) => {
  const candidates = [language, ...LANGUAGE_PREFERENCE, ...node.labels.keys()];
  const found = candidates.find((candidate) => node.labels.has(candidate));
  return found === undefined ? undefined : [...node.labels.get(found)].sort().join(' / ');
};

const compareByLabel = (graph, language) => (left, right) =>
  (displayLabel(graph.node(left), language) ?? '').localeCompare(
    displayLabel(graph.node(right), language) ?? '',
    language,
  );

/**
 * Builds a nested tree rooted at rootIri by following child edges. A node reached again along
 * the same path is truncated and marked, so cycles produce a finite tree.
 *
 * @throws {Error} when the root is not in the graph
 */
export const buildHierarchy = (graph, rootIri, language = DEFAULT_LANGUAGE) => {
  if (!graph.node(rootIri)) {
    throw new Error('The root IRI is not present in the graph');
  }
  const build = (iri, depth, ancestors) => {
    const node = graph.node(iri);
    if (ancestors.has(iri)) {
      return { iri, depth, children: [], descendantCount: 0, truncatedCycle: true };
    }
    const nextAncestors = new Set([...ancestors, iri]);
    const children = [...node.children]
      .sort(compareByLabel(graph, language))
      .map((child) => build(child, depth + 1, nextAncestors));
    const descendantCount = children.reduce((sum, child) => sum + 1 + child.descendantCount, 0);
    return { iri, depth, children, descendantCount, truncatedCycle: false };
  };
  return build(rootIri, 0, new Set());
};

/**
 * Returns the ancestors of a node from the topmost known ancestor down to the node itself,
 * following the first parent at each step. Empty when the node is unknown.
 */
export const pathToRoot = (graph, iri) => {
  if (!graph.node(iri)) {
    return [];
  }
  const path = [iri];
  const seen = new Set(path);
  let current = graph.node(iri);
  while (current.parents.size > 0) {
    const [parent] = current.parents;
    if (seen.has(parent)) {
      break;
    }
    seen.add(parent);
    path.unshift(parent);
    current = graph.node(parent);
  }
  return path;
};
