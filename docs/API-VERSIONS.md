# AMV API versions

Every response from `/v1/` carries `AMV-API-Version`: the version that
served it. A caller may send the same header to say which version its code
was written for; the SDK (`sdk/amv-sdk.mjs`, `API_VERSION`) and the
command-line tool always do.

| Version | Status | Sunset |
|---|---|---|
| `2026-11-01` | current | - |

## The rules

- **No header** means the current version.
- **A version AMV does not know** is refused with 400 and
  `code: "api_version_unknown"`, before anything runs or is charged.
- **A breaking change gets a new version.** Adding a field to a response or
  a new optional parameter is not breaking; removing or renaming one,
  changing a type, or changing what a status code means is.
- **A version is deprecated before it is retired.** While deprecated it
  works as before and every answer carries `Deprecation: true` and
  `Sunset: <date>`; each use is counted per month (`apiver:<version>:<month>`),
  so the owner can see who is still on it before the date. The sunset is at
  least six months after deprecation.
- **After the sunset** the version is refused with 410 and
  `code: "api_version_retired"`, naming the current version.

The table above is `API_VERSIONS` in `src/worker/29-router.js`;
`tests/worker/the-api-says-which-version-it-is` checks both agree.
