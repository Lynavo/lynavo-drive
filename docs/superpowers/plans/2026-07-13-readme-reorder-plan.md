# README.md Section Reordering Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**: Rearrange `README.md` to display high-level product definitions and tech architecture higher up, while pushing execution/installation steps lower.

**Architecture**: Rearrange markdown content blocks in `README.md` without modifying any text within sections.

**Tech Stack**: Markdown, HTML, Prettier.

---

### Task 1: Rearrange Content Sections

**Files**:
- Modify: `README.md`

- [ ] **Step 1: Move OSS Boundaries section**
  Cut the `## 🛡️ OSS Boundaries` section and its content, and paste it immediately after the `## 📸 Screenshots Preview` section table.

- [ ] **Step 2: Move Tech Stack and Architecture sections**
  Cut both `## 🛠️ Tech Stack` and `## 🏗️ Architecture Overview` sections (including tables and diagrams), and paste them immediately after `## ❓ FAQs & Troubleshooting`.

- [ ] **Step 3: Move Prerequisites section**
  Cut the `## ⚙️ Prerequisites` section (including details fold), and paste it immediately after `## 🏗️ Architecture Overview`.

- [ ] **Step 4: Format README**
  Run: `pnpm exec prettier --write README.md`
  Expected: Command succeeds.

- [ ] **Step 5: Verify section links and order**
  Run: `git diff README.md`
  Expected: Verify all sections are moved to their target positions and no content is lost.

- [ ] **Step 6: Commit changes**
  Run: `git commit -am "docs: reorder README sections for better readability"`

---

### Task 2: Final Verification & Commit

**Files**:
- Modify: `README.md`

- [ ] **Step 1: Run validation pipeline**
  Run: `pnpm format:check`
  Expected: Success.
  
  Run: `pnpm typecheck`
  Expected: Success.

- [ ] **Step 2: Commit final format adjustments**
  Run: `git commit -am "docs: final format validation pass for reordered README"`
