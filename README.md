# NVA organisation explorer

A static, RDF-aware view of the organisation data served at
`https://api.nva.unit.no/cristin/organization/...`. It runs entirely in the
browser and deploys to GitHub Pages with no build step.

## What it does

- Reads each API response as **JSON-LD**, expands it with its published context
  and turns it into RDF triples. Triples from every document read are merged into
  one graph keyed by IRI. The chart follows the `partOf` / `hasPart` relation in
  that graph. Nothing is derived from the shape of the identifiers.
- Shows the organisation as a **collapsible chart** and an **indented structure**,
  with a details panel per unit: labels in every language, parents, parts,
  provenance, and the raw statements as N-Triples.
- Reports **findings** a curator would want to know about: cycles, units with
  several parents, siblings sharing a name, conflicting labels, units that are
  referenced but never described, untranslated or missing labels, and, once a
  unit's own document has been read, parents and children that do not agree
  about each other.
- Rolls findings up the tree: every unit carries **bubbles with the number of
  problems and warnings below it**, so a collapsed branch still shows that
  something inside needs attention.
- Offers a **tabular report**: one row per unit with its path, labels, level,
  size and finding counts, or one row per finding. Sortable, filterable, and
  downloadable as CSV for spreadsheets.
- Finds **orphans** by comparing the served tree with Cristin's flat list of
  every unit registered under the institution (`api.cristin.no/v2/units`), and
  reports units registered but unreachable, parents that do not exist, and
  disagreements about who a unit's parent is.
- **Audits a pasted list of IRIs** from your own data: each is dereferenced and
  placed in one category (in the tree, registered but not in the tree,
  dereferenceable but unregistered, does not exist), with CSV export.
- Points out **fields the JSON-LD context does not map** (today: `acronym`),
  which are present in the JSON but absent from the RDF.
- Exports everything read so far as **N-Triples**.

Deep-linkable state lives in the URL fragment: `#org=<iri>&node=<iri>&lang=nb`.

## Toolchain

Node and npm are pinned exactly in `package.json` under `volta` and `engines`.
With [Volta](https://volta.sh) installed, entering the directory selects them
automatically. CI installs Volta with `volta-cli/action`, which reads the same
field and installs exactly that Node and that npm, so there is one source of
truth for both.

```sh
npm ci            # exact dependency tree from package-lock.json
npm run lint      # ESLint, warnings are failures
npm test          # node:test with 100 % line, branch and function coverage enforced
npm run check     # lint + test
npm run build     # assembles the deployable site into dist/
npm run serve     # serves the working tree on http://localhost:8000
```

The site has no runtime dependencies. The only packages are ESLint and its
plugins, installed as exact versions for development. The site must be served
over HTTP, not opened as a file, because it uses ES modules.

## Quality and security gates

- **Tests and coverage.** `node:test` with the built-in coverage reporter.
  Anything under 100 % on lines, branches or functions fails the run.
- **Static analysis.** ESLint with the recommended rules, JSDoc checks and a
  strict rule set (no `var`, `eqeqeq`, `curly`, no shadowing, no unused
  variables, bounded function length and nesting).
- **CodeQL** runs the `security-and-quality` suite on pushes, pull requests and
  weekly.
- **Dependencies.** `npm audit` at high severity blocks the build; the
  dependency review action blocks pull requests that introduce vulnerable
  packages; Dependabot raises weekly updates for both npm packages and actions.
- **Supply chain of the workflow.** Every action is pinned to a full commit SHA
  with the release tag in a comment, runners are pinned to `ubuntu-24.04`,
  permissions are read-only by default, and checkout does not persist
  credentials.
- **Supply chain of the page.** The two CDN scripts carry subresource integrity
  hashes, so a tampered file is refused by the browser.

## Deploying

Push to `main`. The `Verify and deploy` workflow installs, audits, lints,
tests and builds, uploads `dist/`, and deploys it to GitHub Pages. Pull
requests run the same verification without deploying. In the repository
settings, set Pages to deploy from GitHub Actions.

## Layout

| Path | Purpose |
| --- | --- |
| `src/vocabulary.js` | Predicate and term constants for the NVA publication ontology |
| `src/organisation-graph.js` | Merged RDF graph with per-document provenance |
| `src/findings.js` | Curation findings computed over the graph |
| `src/hierarchy.js` | Tree building, ancestor paths and display labels |
| `src/ntriples.js` | N-Triples serialisation |
| `src/json-inspection.js` | Detects JSON fields the context drops |
| `src/chart.js` | d3 collapsible organisation chart |
| `src/registry.js` | Comparison with Cristin's flat unit list |
| `src/audit.js` | Classification of pasted organisation IRIs |
| `src/report.js` | Tabular rows and CSV serialisation |
| `src/app.js` | Browser wiring |
| `test/` | `node:test` suites for the pure modules |
| `eslint.config.js` | Lint configuration |
| `.github/workflows/` | Verify-and-deploy, CodeQL and dependency review |
