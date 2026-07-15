# README.md Traditional Chinese Translation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**: Create a Traditional Chinese translation `README.zh-Hant.md` and link it at the top of the English `README.md` for local community accessibility.

**Architecture**: Write Traditional Chinese translation keeping HTML widgets/tables/folds intact, and inject a language switcher block in both README files.

**Tech Stack**: Markdown, HTML, Prettier.

---

### Task 1: Update English README Header

**Files**:

- Modify: `README.md` (top section)

- [ ] **Step 1: Add language switcher link**
      Insert the language switcher right above the banner inside the centered paragraph tag in `README.md`.

  Code to insert:

  ```html
  <p align="center"><strong>English</strong> | <a href="./README.zh-Hant.md">繁體中文</a></p>
  ```

  Make sure this block is placed at the very top of `README.md` before the banner element.

- [ ] **Step 2: Format README**
      Run: `pnpm exec prettier --write README.md`
      Expected: Success.

- [ ] **Step 3: Commit changes**
      Run: `git commit -am "docs: add Traditional Chinese link to README.md"`

---

### Task 2: Create Traditional Chinese README

**Files**:

- Create: `README.zh-Hant.md`

- [ ] **Step 1: Translate and compose README.zh-Hant.md**
      Write the Traditional Chinese translation, matching all section anchors, details folds, HTML grid tables for screenshots, alerts for OSS boundaries, and CLI command snippets. Keep links referencing documentation target paths correctly.

  Include this language switcher header at the very top:

  ```html
  <p align="center"><a href="./README.md">English</a> | <strong>繁體中文</strong></p>
  ```

- [ ] **Step 2: Format README.zh-Hant.md**
      Run: `pnpm exec prettier --write README.zh-Hant.md`
      Expected: Success.

- [ ] **Step 3: Commit README.zh-Hant.md**
      Run: `git add README.zh-Hant.md && git commit -m "docs: create README.zh-Hant.md with Traditional Chinese translation"`

---

### Task 3: Final Format & Verification

**Files**:

- Modify: `README.md`, `README.zh-Hant.md`

- [ ] **Step 1: Run validation pipeline**
      Run: `pnpm format:check`
      Expected: Success.

  Run: `pnpm typecheck`
  Expected: Success.

- [ ] **Step 2: Commit final format adjustments**
      Run: `git commit -am "docs: final validation and format pass for translation"`
