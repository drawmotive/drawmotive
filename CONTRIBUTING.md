# Contributing to DrawMotive Editor

Report package/API bugs in the
[issue tracker](https://github.com/drawmotive/drawmotive/issues), with version,
OS, Node/npm or browser version, expected behavior and a small host example.

Use Node.js 22 and its bundled npm on Linux, Windows or macOS. Vite host
applications require Node 22.12+ on the 22 line. Browser support is currently
verified in Chromium; see the [support matrix](README.md#supported-environments).

A standalone public checkout builds the JavaScript package against its
committed compiled editor assets:

```bash
npm ci
npm run source:check
npm test
npm run build
npm run assets:verify
npm run audit:package
npm pack --ignore-scripts
```

This sequence creates a source snapshot after explicit tests, asset verification
and package auditing. No .NET SDK, private source, credentials or sibling checkout
is needed. Runtime production remains separate: compiled assets and their exact
producer provenance must be synchronized from a verified companion source build.
`source:check` runs complete native readiness checks in a disposable copy using
the actual manifest's producer; it leaves the formal target and plan unchanged.

The formal release target can still describe a previously published version.
Ordinary `npm pack`, `npm run release:check` and publication retain the strict
prepack release checks and reject a source snapshot whose native producer differs
from that target. Select and prepare a matching new release before publication;
do not relabel source assets as the frozen producer.

For integration changes, run the real Chromium browser suite:

```bash
npx playwright install chromium
npm run test:browser
```

Linux CI installs browser system dependencies with `--with-deps`. The browser
tests do not establish Firefox, WebKit or mobile-device compatibility.

Use `npm ci` with the committed public registry lock; update dependencies
with `npm install` only intentionally and commit their lockfile together.
Do not use developer-local paths or workspace links as release inputs.

Keep pull requests focused and explain behavior, verification and remaining
limits. Add a regression for a behavior fix; review links and commands for
documentation changes. Preserve the [MIT license](LICENSE), third-party
runtime terms and font notices indexed in [NOTICE](NOTICE).
