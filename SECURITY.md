# Security Policy

## Supported Versions

TV Time Capsule is currently an early public project. Security fixes will be applied to the latest version on the `main` branch.

| Version | Supported |
| --- | --- |
| Latest `main` | Yes |
| Older copies/forks | No |

## Reporting a Vulnerability

If you find a security or privacy issue, please do **not** open a public GitHub issue.

Report it privately using GitHub Security Advisories:

1. Open the repository on GitHub.
2. Go to **Security**.
3. Select **Report a vulnerability**.
4. Include a clear description of the issue, steps to reproduce it, and the possible impact.

If GitHub Security Advisories are not available, contact the repository owner directly through GitHub.

## What Counts As A Security Issue

Please report issues such as:

- TV Time GDPR export files being uploaded to a server unintentionally.
- Sensitive data from the GDPR export being stored when it should be skipped.
- Access tokens, login data, IP addresses, device IDs, ad IDs, or social identity data being imported into the local app database.
- Cross-site scripting or unsafe HTML rendering from imported GDPR data.
- Third-party API calls leaking private user data beyond show/movie titles needed for metadata lookup.
- Any behavior that exposes a user’s private viewing history outside their own browser.

## Privacy Model

TV Time Capsule is designed as a local-first static browser app.

- The user opens the app locally in their browser.
- GDPR ZIP files are processed in the browser.
- The app should not upload the GDPR ZIP or raw export files anywhere.
- The app should only store cleaned entertainment-history data locally.
- Sensitive GDPR files and fields should be skipped by default.

Metadata lookups may contact third-party public APIs to fetch posters and show/movie information. These requests should only use the minimum title/search information needed.

## Disclosure Process

After a valid report is received:

1. The issue will be reviewed as soon as possible.
2. If confirmed, a fix will be prepared privately where appropriate.
3. A patched version will be published to the repository.
4. Credit may be given to the reporter if requested.

Please allow reasonable time for review and fixes before public disclosure.
