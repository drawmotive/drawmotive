# Browser verification inputs

`npm run test:browser` uses the SDK source in this checkout and the packaged native assets by default. When storage or private bridge contracts change, first build a native candidate from the matching host commit, then set `DRAWMOTIVE_EDITOR_TEST_ASSET_ROOT` to that candidate's absolute `generated/editor` directory. The test server substitutes only native asset requests, leaving current SDK sources and Workers in place.

This input does not replace the sealed package assets or change release authority.
