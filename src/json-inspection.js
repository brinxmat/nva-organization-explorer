const JSON_LD_KEYWORD_PREFIX = '@';

const LANGUAGE_MAP_TERMS = new Set(['labels', 'name']);

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const isScalar = (value) => value !== null && typeof value !== 'object';

const isKeyword = (key) => key.startsWith(JSON_LD_KEYWORD_PREFIX);

const nodeObjects = (value) => {
  if (Array.isArray(value)) {
    return value.flatMap(nodeObjects);
  }
  if (!isPlainObject(value)) {
    return [];
  }
  const nested = Object.entries(value)
    .filter(([key]) => !LANGUAGE_MAP_TERMS.has(key))
    .flatMap(([, child]) => nodeObjects(child));
  return [value, ...nested];
};

const unmappedEntriesOf = (nodeObject, contextTerms) =>
  Object.entries(nodeObject).filter(([key]) => !isKeyword(key) && !contextTerms.has(key));

/**
 * Keys used anywhere in the JSON document that the JSON-LD context does not map. Values under
 * these keys are silently dropped when the document is read as RDF.
 */
export const unmappedKeys = (jsonDocument, contextTerms) =>
  new Set(
    nodeObjects(jsonDocument).flatMap((nodeObject) =>
      unmappedEntriesOf(nodeObject, contextTerms).map(([key]) => key),
    ),
  );

/**
 * Scalar values of unmapped keys, grouped by the id of the node object carrying them, so a UI
 * can still show them while making clear they are not part of the graph.
 */
export const jsonOnlyPropertiesById = (jsonDocument, contextTerms) =>
  nodeObjects(jsonDocument)
    .filter((nodeObject) => typeof nodeObject.id === 'string')
    .reduce((byId, nodeObject) => {
      const scalars = Object.fromEntries(
        unmappedEntriesOf(nodeObject, contextTerms).filter(([, value]) => isScalar(value)),
      );
      if (Object.keys(scalars).length > 0) {
        byId.set(nodeObject.id, { ...(byId.get(nodeObject.id) ?? {}), ...scalars });
      }
      return byId;
    }, new Map());
