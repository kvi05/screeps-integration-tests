## Description

<!-- Briefly describe what this PR does and why. -->

## Checklist

<!-- Check all that apply. If an item doesn't apply, mark it with `N/A`. -->

### Local verification

- [ ] `npm run check` passes (lint → format:check → unit tests → integration tests)

### API & compatibility

- [ ] **Public API has NOT changed** — or changes are documented below
- [ ] New public exports follow the trickle-down pattern (`src/lib/` → `src/public/` → `package.json` `"exports"`)
- [ ] New public re-export files follow the JSDoc template (see `src/public/assertions.js` as reference)

### Code quality

- [ ] New code has test coverage (unit test in `tests/` or scenario in `examples/scenarios/`)
- [ ] New code comments are in English (existing Russian comments left untouched)
- [ ] Breaking changes are described in the PR description below

### Public API changes

<!-- If "Public API has NOT changed" is unchecked, describe what changed and why.
     Include:
     - Which sub-path exports were added/modified/removed
     - Whether existing consumers need to update their code
     - Whether documentation (`docs/API-REFERENCE.md`) was updated
-->

_No public API changes._
