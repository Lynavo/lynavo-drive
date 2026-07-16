# GitHub Pull Request Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the governance branch, enforce the documented `main` policy in GitHub, and open a pull request that exercises the new workflow.

**Architecture:** Keep all durable contributor guidance in Git while treating GitHub repository settings as a separately verified deployment. Push the implementation branch before activating protection, then create one active repository ruleset scoped only to `refs/heads/main`.

**Tech Stack:** Git, GitHub CLI, GitHub REST API, repository rulesets

---

### Task 1: Publish The Implementation Branch

**Files:**

- No additional file changes

- [ ] **Step 1: Confirm branch and commits**

```bash
git status --short
git branch --show-current
git log --oneline main..HEAD
```

Expected: clean `chore/pr-governance` branch with the design and implementation
commits listed.

- [ ] **Step 2: Push without modifying main**

```bash
git push -u origin chore/pr-governance
```

Expected: the remote branch is created and tracks `origin/chore/pr-governance`.

### Task 2: Standardize Repository Merge Settings

**Files:**

- No repository file changes

- [ ] **Step 1: Apply merge policy**

```bash
gh api --method PATCH repos/Lynavo/lynavo-drive \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -F allow_auto_merge=false
```

Expected: HTTP success with squash enabled, merge/rebase disabled, automatic
branch deletion enabled, and auto-merge disabled.

- [ ] **Step 2: Read back merge policy**

```bash
gh api repos/Lynavo/lynavo-drive --jq '{allow_squash_merge,allow_merge_commit,allow_rebase_merge,delete_branch_on_merge,allow_auto_merge}'
```

Expected:

```json
{
  "allow_auto_merge": false,
  "allow_merge_commit": false,
  "allow_rebase_merge": false,
  "allow_squash_merge": true,
  "delete_branch_on_merge": true
}
```

### Task 3: Create The Main Branch Ruleset

**Files:**

- No repository file changes

- [ ] **Step 1: Confirm no conflicting ruleset exists**

```bash
gh api repos/Lynavo/lynavo-drive/rulesets --jq 'map({id,name,target,enforcement})'
```

Expected: no active branch ruleset scoped to `main`.

- [ ] **Step 2: Create the active ruleset**

Run this exact request:

```bash
gh api --method POST repos/Lynavo/lynavo-drive/rulesets --input - <<'JSON'
{
  "name": "Protect main pull request flow",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    {"type": "deletion"},
    {"type": "non_fast_forward"},
    {
      "type": "pull_request",
      "parameters": {
        "allowed_merge_methods": ["squash"],
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": false,
        "required_approving_review_count": 1,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "do_not_enforce_on_create": true,
        "required_status_checks": [
          {"context": "OSS Release Gate"},
          {"context": "TS Quality"},
          {"context": "Go Tests"},
          {"context": "Native Builds"}
        ],
        "strict_required_status_checks_policy": true
      }
    }
  ]
}
JSON
```

Expected: HTTP 201 and an active repository ruleset ID.

- [ ] **Step 3: Read back and verify the ruleset**

```bash
RULESET_ID="$(gh api repos/Lynavo/lynavo-drive/rulesets \
  --jq '.[] | select(.name == "Protect main pull request flow") | .id')"
gh api "repos/Lynavo/lynavo-drive/rulesets/$RULESET_ID" \
  --jq '{name,target,enforcement,conditions,rules,bypass_actors}'
```

Verify the target, condition, pull-request parameters, four exact status
contexts, deletion rule, and non-fast-forward rule. Do not continue if any rule
is absent or enforcement is not `active`.

### Task 4: Open And Verify The Governance Pull Request

**Files:**

- No additional file changes

- [ ] **Step 1: Open the pull request**

Create a pull request from `chore/pr-governance` to `main` with title:

```text
chore: establish pull request governance
```

The body must summarize the new ownership/templates/tests/documentation, list
the validation commands, state that runtime and shared contracts are unchanged,
and note that another repository administrator must approve it.

- [ ] **Step 2: Verify policy evaluation**

```bash
gh pr view --json number,url,state,mergeStateStatus,reviewDecision,statusCheckRollup
```

Expected: an open pull request that is not mergeable without one approval and
the four required checks.

- [ ] **Step 3: Report the handoff**

Report the pull request URL, ruleset ID, exact merge settings, check status, and
the required human action. Do not approve or merge the pull request as its
author.
