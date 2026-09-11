import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FINDING_KIND, SEVERITY } from '../src/findings.js';
import {
  institutionNumberOf,
  registryPageUrl,
  nextPageUrl,
  registryUnits,
  registryQuadsFor,
  compareRegistry,
} from '../src/registry.js';
import { iriOf, ORGANISATION_BASE } from './quad-builder.js';

const ROOT = iriOf('185.90.0.0');
const FACULTY = iriOf('185.11.0.0');
const STRAY = iriOf('185.0.0.0');
const GHOST_PARENT = iriOf('185.99.0.0');

const listing = [
  { cristin_unit_id: '185.90.0.0', unit_name: { nb: 'Universitetet i Oslo', en: 'University of Oslo' }, acronym: 'UIO' },
  { cristin_unit_id: '185.11.0.0', unit_name: { nb: 'Det teologiske fakultet' }, parent_unit: { cristin_unit_id: '185.90.0.0' } },
  { cristin_unit_id: '185.0.0.0', unit_name: { nb: 'Universitetet i Oslo' }, parent_unit: { cristin_unit_id: '185.90.0.0' } },
];

describe('institutionNumberOf', () => {
  it('shouldThrowWhenIriDoesNotEndInDottedIdentifier', () => {
    assert.throws(() => institutionNumberOf('https://example.org/x'), /institution/);
  });

  it('shouldThrowForIriWithoutPath', () => {
    assert.throws(() => institutionNumberOf(''), /institution/);
  });

  it('shouldReturnFirstComponentOfIdentifier', () => {
    assert.equal(institutionNumberOf(ROOT), '185');
  });
});

describe('registryPageUrl', () => {
  it('shouldBuildPagedUrlForInstitution', () => {
    const url = new URL(registryPageUrl('185', 2));

    assert.equal(url.origin + url.pathname, 'https://api.cristin.no/v2/units');
    assert.equal(url.searchParams.get('institution'), '185');
    assert.equal(url.searchParams.get('page'), '2');
    assert.ok(Number(url.searchParams.get('per_page')) > 0);
  });
});

describe('nextPageUrl', () => {
  it('shouldReturnUndefinedForMissingHeader', () => {
    assert.equal(nextPageUrl(null), undefined);
  });

  it('shouldReturnUndefinedWhenNoNextRelation', () => {
    assert.equal(nextPageUrl('<https://api.cristin.no/v2/units?page=1>; rel="prev"'), undefined);
  });

  it('shouldReturnUndefinedForEmptyHeader', () => {
    assert.equal(nextPageUrl(''), undefined);
  });

  it('shouldExtractNextRelation', () => {
    const header = '<https://api.cristin.no/v2/units?page=1>; rel="prev", <https://api.cristin.no/v2/units?page=3>; rel="next"';

    assert.equal(nextPageUrl(header), 'https://api.cristin.no/v2/units?page=3');
  });
});

describe('registryUnits', () => {
  it('shouldSkipEntriesWithoutIdentifier', () => {
    assert.deepEqual(registryUnits([{ unit_name: { nb: 'x' } }], ORGANISATION_BASE), []);
  });

  it('shouldToleratMissingNamesAndParents', () => {
    const [unit] = registryUnits([{ cristin_unit_id: '185.55.0.0' }], ORGANISATION_BASE);

    assert.equal(unit.labels.size, 0);
    assert.equal(unit.parentIri, undefined);
    assert.equal(unit.acronym, undefined);
  });

  it('shouldMapIdentifiersToOrganisationIrisAndParents', () => {
    const units = registryUnits(listing, ORGANISATION_BASE);

    assert.equal(units[0].iri, ROOT);
    assert.equal(units[0].parentIri, undefined);
    assert.equal(units[1].parentIri, ROOT);
    assert.deepEqual([...units[0].labels.entries()], [['nb', 'Universitetet i Oslo'], ['en', 'University of Oslo']]);
    assert.equal(units[0].acronym, 'UIO');
  });
});

describe('registryQuadsFor', () => {
  it('shouldReturnNoQuadsForNoUnits', () => {
    assert.deepEqual(registryQuadsFor([]), []);
  });

  it('shouldOmitPartOfForParentlessUnit', () => {
    const [root] = registryUnits(listing, ORGANISATION_BASE);

    const quads = registryQuadsFor([root]);

    assert.ok(quads.every((quad) => !quad.predicate.value.endsWith('partOf')));
  });

  it('shouldEmitTypeLabelsAndPartOf', () => {
    const [, faculty] = registryUnits(listing, ORGANISATION_BASE);

    const quads = registryQuadsFor([faculty]);

    const predicates = quads.map((quad) => quad.predicate.value.split('#').at(-1)).sort();
    assert.deepEqual(predicates, ['label', 'partOf', 'type'].sort());
    const partOf = quads.find((quad) => quad.predicate.value.endsWith('partOf'));
    assert.equal(partOf.subject.value, FACULTY);
    assert.equal(partOf.object.value, ROOT);
    const label = quads.find((quad) => quad.predicate.value.endsWith('label'));
    assert.equal(label.object.language, 'nb');
  });
});

describe('compareRegistry', () => {
  const tree = new Map([
    [ROOT, undefined],
    [FACULTY, ROOT],
  ]);

  it('shouldReportNothingWhenRegistryAndTreeAgree', () => {
    const units = registryUnits(listing.slice(0, 2), ORGANISATION_BASE);

    assert.deepEqual(compareRegistry(units, tree), []);
  });

  it('shouldReportRegisteredUnitMissingFromTreeAsOrphan', () => {
    const units = registryUnits(listing, ORGANISATION_BASE);

    const [finding] = compareRegistry(units, tree);

    assert.equal(finding.kind, FINDING_KIND.ORPHAN);
    assert.equal(finding.severity, SEVERITY.PROBLEM);
    assert.deepEqual(finding.subjects, [STRAY]);
    assert.deepEqual(finding.detail, { parent: ROOT });
  });

  it('shouldReportParentUnknownToBothRegistryAndTree', () => {
    const units = registryUnits(
      [...listing.slice(0, 2), { cristin_unit_id: '185.55.0.0', unit_name: { nb: 'Løs' }, parent_unit: { cristin_unit_id: '185.99.0.0' } }],
      ORGANISATION_BASE,
    );

    const findings = compareRegistry(units, tree);

    const dangling = findings.find((finding) => finding.kind === FINDING_KIND.DANGLING_PARENT);
    assert.deepEqual(dangling.subjects, [iriOf('185.55.0.0')]);
    assert.deepEqual(dangling.detail, { parent: GHOST_PARENT });
  });

  it('shouldReportTreeUnitAbsentFromRegistry', () => {
    const units = registryUnits(listing.slice(0, 1), ORGANISATION_BASE);

    const [finding] = compareRegistry(units, tree);

    assert.equal(finding.kind, FINDING_KIND.NOT_IN_REGISTRY);
    assert.equal(finding.severity, SEVERITY.NOTE);
    assert.deepEqual(finding.subjects, [FACULTY]);
  });

  it('shouldReportParentDisagreementBetweenRegistryAndTree', () => {
    const units = registryUnits(
      [listing[0], { cristin_unit_id: '185.11.0.0', unit_name: { nb: 'TF' }, parent_unit: { cristin_unit_id: '185.0.0.0' } }],
      ORGANISATION_BASE,
    );

    const findings = compareRegistry(units, tree);

    const differs = findings.find((finding) => finding.kind === FINDING_KIND.REGISTRY_PARENT_DIFFERS);
    assert.deepEqual(differs.subjects, [FACULTY]);
    assert.deepEqual(differs.detail, { registryParent: STRAY, treeParent: ROOT });
  });
});
