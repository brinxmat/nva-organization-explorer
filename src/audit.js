export const AUDIT_CATEGORY = Object.freeze({
  IN_TREE: 'in-tree',
  ORPHAN: 'orphan',
  GHOST: 'ghost',
  OUTSIDE_TREE: 'outside-tree',
  OTHER_ROOT: 'other-root',
  NOT_FOUND: 'not-found',
  ERROR: 'error',
});

export const AUDIT_CATEGORY_TEXT = Object.freeze({
  [AUDIT_CATEGORY.IN_TREE]: 'In the served tree',
  [AUDIT_CATEGORY.ORPHAN]: 'Registered, but not in the served tree',
  [AUDIT_CATEGORY.GHOST]: 'Dereferenceable, but neither registered nor in the tree',
  [AUDIT_CATEGORY.OUTSIDE_TREE]: 'Not in the served tree (registry not loaded)',
  [AUDIT_CATEGORY.OTHER_ROOT]: 'Under a different root',
  [AUDIT_CATEGORY.NOT_FOUND]: 'Does not exist',
  [AUDIT_CATEGORY.ERROR]: 'Could not be checked',
});

export const AUDIT_COLUMNS = Object.freeze([
  { key: 'iri', heading: 'IRI' },
  { key: 'category', heading: 'Category' },
  { key: 'httpStatus', heading: 'HTTP status', numeric: true },
  { key: 'label', heading: 'Label' },
  { key: 'declaredParent', heading: 'Declared parent' },
  { key: 'declaredParentLabel', heading: 'Declared parent label' },
  { key: 'inTree', heading: 'In tree' },
  { key: 'inRegistry', heading: 'In registry' },
]);

const HTTP_NOT_FOUND = 404;
const HTTP_SUCCESS_LOWER = 200;
const HTTP_SUCCESS_UPPER = 300;
const IDENTIFIER_PATTERN = /^\d+(?:\.\d+){3}$/;
const SEPARATORS = /[\s,;]+/;
const SURROUNDING_QUOTES = /^["']+|["']+$/g;

/**
 * Splits pasted text into organisation IRIs. Bare Cristin identifiers are accepted and turned
 * into IRIs; anything else is returned as rejected so the caller can show it.
 */
export const parseIriList = (text, organisationBase) => {
  const tokens = text
    .split(SEPARATORS)
    .map((token) => token.replace(SURROUNDING_QUOTES, ''))
    .filter((token) => token.length > 0);
  const iris = tokens
    .filter((token) => token.startsWith(organisationBase) || IDENTIFIER_PATTERN.test(token))
    .map((token) => (token.startsWith(organisationBase) ? token : `${organisationBase}${token}`));
  const rejected = tokens.filter((token) => !token.startsWith(organisationBase) && !IDENTIFIER_PATTERN.test(token));
  return { iris: [...new Set(iris)], rejected };
};

const isSuccess = (httpStatus) => httpStatus >= HTTP_SUCCESS_LOWER && httpStatus < HTTP_SUCCESS_UPPER;

/**
 * Places one dereferenced IRI in exactly one audit category. underLoadedRoot is false when the
 * unit's own ancestor chain ends at a root other than the one that is open, and undefined when
 * that could not be determined.
 */
export const classify = ({ httpStatus, inTree, inRegistry, registryLoaded, underLoadedRoot }) => {
  if (httpStatus === HTTP_NOT_FOUND) {
    return AUDIT_CATEGORY.NOT_FOUND;
  }
  if (!isSuccess(httpStatus)) {
    return AUDIT_CATEGORY.ERROR;
  }
  if (inTree) {
    return AUDIT_CATEGORY.IN_TREE;
  }
  if (underLoadedRoot === false) {
    return AUDIT_CATEGORY.OTHER_ROOT;
  }
  if (!registryLoaded) {
    return AUDIT_CATEGORY.OUTSIDE_TREE;
  }
  return inRegistry ? AUDIT_CATEGORY.ORPHAN : AUDIT_CATEGORY.GHOST;
};
