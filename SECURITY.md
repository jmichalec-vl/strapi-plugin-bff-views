# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | yes       |
| < 1.0   | no        |

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private
vulnerability reporting on this repository ("Security" tab, "Report a
vulnerability"). You will get an acknowledgement within a few days and a fix
or mitigation plan before any public disclosure.

The plugin's threat model is documented in the README under "Security model":
every query result is sanitized by Strapi's content API before transformers
and hooks run, draft access is an explicit per-view opt-in, cache entries are
keyed by caller identity, and no client input ever shapes `populate`,
`fields` or `filters`. Reports about any of these guarantees are especially
welcome.
