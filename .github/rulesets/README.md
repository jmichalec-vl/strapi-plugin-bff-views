# Repository rulesets

Source of truth for the GitHub rulesets protecting this repository. Apply or
update them with the GitHub CLI (replace `<owner>/<repo>`):

```bash
gh api -X POST repos/<owner>/<repo>/rulesets --input .github/rulesets/main-branch.json
gh api -X POST repos/<owner>/<repo>/rulesets --input .github/rulesets/release-tags.json
```

To update an existing ruleset, find its id with
`gh api repos/<owner>/<repo>/rulesets` and use `-X PUT .../rulesets/<id>`.

## What they enforce

- `main-branch`: no deletion or force-push, linear history, pull requests with
  one approving review from a code owner (`.github/CODEOWNERS`: the
  maintainer), re-approval after every push, all four CI jobs green on an
  up-to-date branch. Collaborators with the Write role can open and review
  pull requests but cannot merge without the maintainer's approval.
  It deliberately has no `creation`/`update` (restrict updates) rules: those
  block every write to the ref including pull-request merges, and the web
  merge path does not apply the Admin bypass to them.
- `release-tags`: `v*` tags cannot be created, moved or deleted by hand.

## Bypass actors

- `RepositoryRole 5` (Admin): the maintainer can merge their own pull requests
  and recover from mistakes. The release workflow (`release.yml`) opens the
  Release PR and creates the `v*` tag and the GitHub Release with the
  maintainer's `GH_PAT` secret for the same reason: on a user-owned
  repository GitHub does not accept the GitHub Actions app as a bypass actor,
  so the built-in `GITHUB_TOKEN` cannot write to a protected ref, and a PR it
  opens would not trigger CI. Use a fine-grained token limited to this
  repository with `Contents`, `Pull requests` and `Issues` set to read and
  write (release-please labels the Release PR through the issues endpoint),
  and rotate it on a schedule.

## Also enable in Settings > Code security

Secret scanning with push protection, Dependabot alerts and security updates,
and CodeQL default setup. `.github/dependabot.yml` keeps npm dependencies and
action versions current.
