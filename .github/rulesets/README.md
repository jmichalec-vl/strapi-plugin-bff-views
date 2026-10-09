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
  one approving review, all four CI jobs green on an up-to-date branch.
  It deliberately has no `creation`/`update` (restrict updates) rules: those
  block every write to the ref including pull-request merges, and the web
  merge path does not apply the Admin bypass to them.
- `release-tags`: `v*` tags cannot be created, moved or deleted by hand.

## Bypass actors

- `RepositoryRole 5` (Admin): the maintainer can merge their own pull requests
  and recover from mistakes. The publish workflow pushes its version commit
  and tag to `main` with the maintainer's `GH_PAT` secret for the same
  reason: on a user-owned repository GitHub does not accept the GitHub
  Actions app as a bypass actor, so the built-in `GITHUB_TOKEN` cannot push
  to a protected branch. Use a fine-grained token limited to this repository
  with `Contents: read and write`, and rotate it on a schedule.

## Also enable in Settings > Code security

Secret scanning with push protection, Dependabot alerts and security updates,
and CodeQL default setup. `.github/dependabot.yml` keeps npm dependencies and
action versions current.
