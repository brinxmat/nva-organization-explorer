import { FINDING_KIND, SEVERITY } from './findings.js';
import { ORGANISATION_TYPE, PREDICATE, RDF_LANG_STRING, TERM_TYPE } from './vocabulary.js';

export const REGISTRY_UNITS_URL = 'https://api.cristin.no/v2/units';
const PAGE_SIZE = 1000;
const REGISTRY_LANGUAGES = 'nb,en,nn';
const IDENTIFIER_PATTERN = /^(\d+)(?:\.\d+){3}$/;
const NEXT_LINK_PATTERN = /<([^>]+)>\s*;\s*rel="next"/;

/**
 * The Cristin institution number the registry is keyed by. This is the one place the explorer
 * reads anything out of an identifier, and only because Cristin's listing requires it.
 *
 * @throws {Error} when the IRI does not end in a Cristin unit identifier
 */
export const institutionNumberOf = (iri) => {
  const match = IDENTIFIER_PATTERN.exec(iri.split('/').at(-1));
  if (!match) {
    throw new Error('Cannot derive a Cristin institution number from this IRI');
  }
  return match[1];
};

export const registryPageUrl = (institutionNumber, page) => {
  const url = new URL(REGISTRY_UNITS_URL);
  url.searchParams.set('institution', institutionNumber);
  url.searchParams.set('per_page', String(PAGE_SIZE));
  url.searchParams.set('page', String(page));
  url.searchParams.set('lang', REGISTRY_LANGUAGES);
  return url.toString();
};

/** @returns the URL of the next page from an HTTP Link header, or undefined when there is none */
export const nextPageUrl = (linkHeader) =>
  linkHeader
    ?.split(',')
    .map((part) => NEXT_LINK_PATTERN.exec(part.trim()))
    .find(Boolean)?.[1];

/** Registry entries as immutable units addressed by their NVA organisation IRI. */
export const registryUnits = (listing, organisationBase) =>
  listing
    .filter((entry) => typeof entry.cristin_unit_id === 'string')
    .map((entry) =>
      Object.freeze({
        iri: `${organisationBase}${entry.cristin_unit_id}`,
        labels: new Map(Object.entries(entry.unit_name ?? {})),
        acronym: entry.acronym,
        parentIri: entry.parent_unit?.cristin_unit_id ? `${organisationBase}${entry.parent_unit.cristin_unit_id}` : undefined,
      }),
    );

const namedNode = (value) => ({ termType: TERM_TYPE.NAMED_NODE, value });

const languageLiteral = (value, language) => ({
  termType: TERM_TYPE.LITERAL,
  value,
  language,
  datatype: namedNode(RDF_LANG_STRING),
});

const quad = (subject, predicate, object) => ({ subject: namedNode(subject), predicate: namedNode(predicate), object });

/** RDF/JS quads stating what the registry says about the given units, in the NVA vocabulary. */
export const registryQuadsFor = (units) =>
  units.flatMap((unit) => [
    quad(unit.iri, PREDICATE.TYPE, namedNode(ORGANISATION_TYPE)),
    ...[...unit.labels.entries()].map(([language, label]) => quad(unit.iri, PREDICATE.LABEL, languageLiteral(label, language))),
    ...(unit.parentIri ? [quad(unit.iri, PREDICATE.PART_OF, namedNode(unit.parentIri))] : []),
  ]);

const finding = (kind, severity, subjects, detail) => Object.freeze({ kind, severity, subjects, detail });

/**
 * Compares the registry's flat list with the served tree.
 *
 * @param units registry units for the institution
 * @param tree map from every IRI in the served tree to its parent IRI, undefined for the root
 */
export const compareRegistry = (units, tree) => {
  const registryIris = new Set(units.map((unit) => unit.iri));
  const orphans = units
    .filter((unit) => !tree.has(unit.iri))
    .map((unit) => finding(FINDING_KIND.ORPHAN, SEVERITY.PROBLEM, [unit.iri], { parent: unit.parentIri }));
  const dangling = units
    .filter((unit) => unit.parentIri && !registryIris.has(unit.parentIri) && !tree.has(unit.parentIri))
    .map((unit) => finding(FINDING_KIND.DANGLING_PARENT, SEVERITY.PROBLEM, [unit.iri], { parent: unit.parentIri }));
  const differs = units
    .filter((unit) => tree.has(unit.iri) && unit.parentIri && tree.get(unit.iri) && unit.parentIri !== tree.get(unit.iri))
    .map((unit) =>
      finding(FINDING_KIND.REGISTRY_PARENT_DIFFERS, SEVERITY.PROBLEM, [unit.iri], {
        registryParent: unit.parentIri,
        treeParent: tree.get(unit.iri),
      }),
    );
  const notInRegistry = [...tree.keys()]
    .filter((iri) => !registryIris.has(iri))
    .map((iri) => finding(FINDING_KIND.NOT_IN_REGISTRY, SEVERITY.NOTE, [iri], {}));
  return [...orphans, ...dangling, ...differs, ...notInRegistry];
};
