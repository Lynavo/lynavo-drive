# README.md Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**: Redesign the landing `README.md` to achieve premium visual quality using banner, logo, shields.io badges, screenshots preview grid, and folded `<details>` sections for developer CLI commands.

**Architecture**: Structural overhaul of Markdown and HTML code blocks in `README.md`, optimizing reading hierarchy without breaking local build commands.

**Tech Stack**: Markdown, HTML, Prettier.

---

### Task 1: Hero Header & Badges

**Files**:

- Modify: `README.md` (top section)

- [ ] **Step 1: Replace original header with visual layout**
      Update the top section of `README.md` (lines 1 to 9) to introduce the Banner, Logo, Shields.io Badges, and dynamic link shortcuts.

  Replace:

  ```markdown
  # Lynavo Drive

  Lynavo Drive is a local-LAN incremental media sync tool from mobile
  (iOS / Android) to desktop (macOS / Windows), built for global users and video
  teams. The current open-source baseline maintains one OSS local build path only
  ...
  ```

  With:

  ```html
  <p align="center">
    <img src="./screenshots/banner.png" alt="Lynavo Drive Banner" width="100%" />
  </p>

  <p align="center">
    <img src="./screenshots/logo.png" alt="Lynavo Drive Logo" width="100" />
  </p>

  <h1 align="center">Lynavo Drive</h1>

  <p align="center">
    <strong
      >A high-performance, local-LAN incremental media sync tool from mobile (iOS / Android) to
      desktop (macOS / Windows).</strong
    >
  </p>

  <p align="center">
    <img
      src="https://img.shields.io/badge/Node.js-%3E%3D%2022.12.0-blue?style=flat-square&logo=node.js"
      alt="Node Version"
    />
    <img
      src="https://img.shields.io/badge/Go-%3E%3D%201.25.6-00ADD8?style=flat-square&logo=go"
      alt="Go Version"
    />
    <img
      src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey?style=flat-square"
      alt="Desktop Platform"
    />
    <img
      src="https://img.shields.io/badge/Mobile-iOS%20%7C%20Android-lightgrey?style=flat-square"
      alt="Mobile Platform"
    />
    <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License" />
  </p>

  <p align="center">
    <a href="#-screenshots-preview">Screenshots</a> • <a href="#-key-features">Key Features</a> •
    <a href="#-quick-start">Quick Start</a> • <a href="#-oss-boundary">OSS Boundaries</a> •
    <a href="#-tech-stack">Tech Stack</a>
  </p>

  ---
  ```

- [ ] **Step 2: Format the file**
      Run: `pnpm exec prettier --write README.md`
      Expected: Command succeeds and formats the document.

- [ ] **Step 3: Verify the changes**
      Run: `git diff README.md`
      Expected: Show the HTML tags replacing the top headers and badges added correctly.

- [ ] **Step 4: Commit**
      Run: `git commit -am "docs: redesign README hero header with banner and badges"`

---

### Task 2: Screenshots Preview Grid

**Files**:

- Modify: `README.md` (after Current Status section)

- [ ] **Step 1: Insert screenshots grid table**
      Below the `## Current Status` section, insert the screenshots grid using HTML tables with aligned columns and descriptively styled thumbnails.

  Code to insert:

  ```html
  ## 📸 Screenshots Preview

  <table width="100%">
    <tr>
      <td width="33%" align="center">
        <strong>1. Device Discovery</strong><br />
        <img src="./screenshots/screenshot_1.png" alt="Device Discovery" width="100%" /><br />
        <sub>Local LAN pairing via mDNS</sub>
      </td>
      <td width="33%" align="center">
        <strong>2. Mobile Media Scan</strong><br />
        <img src="./screenshots/screenshot_2.png" alt="Mobile Media Scan" width="100%" /><br />
        <sub>Incremental scanner for photo libraries</sub>
      </td>
      <td width="33%" align="center">
        <strong>3. Active Sync Queue</strong><br />
        <img src="./screenshots/screenshot_3.png" alt="Sync Queue" width="100%" /><br />
        <sub>Serial file upload tracking</sub>
      </td>
    </tr>
    <tr>
      <td width="33%" align="center">
        <strong>4. Sync History</strong><br />
        <img src="./screenshots/screenshot_4.png" alt="Sync History" width="100%" /><br />
        <sub>Transfer logs and daily completion stats</sub>
      </td>
      <td width="33%" align="center">
        <strong>5. Desktop Settings</strong><br />
        <img src="./screenshots/screenshot_5.png" alt="Desktop Settings" width="100%" /><br />
        <sub>Shared target directory configurations</sub>
      </td>
      <td width="33%" align="center">
        <!-- Empty cell for grid layout balance -->
      </td>
    </tr>
  </table>
  ```

- [ ] **Step 2: Format the file**
      Run: `pnpm exec prettier --write README.md`
      Expected: Command succeeds.

- [ ] **Step 3: Verify output**
      Run: `git diff README.md`
      Expected: Verify the HTML table markup and paths are correct.

- [ ] **Step 4: Commit**
      Run: `git commit -am "docs: add screenshots grid to README"`

---

### Task 3: Key Features & OSS Boundary Restructuring

**Files**:

- Modify: `README.md`

- [ ] **Step 1: Convert key features and boundaries to blockquote alerts**
      Enhance readability by wrapping OSS boundaries with GitHub-native Blockquote Alerts (`> [!IMPORTANT]` and `> [!NOTE]`). Also group key features clearly.

  Update `## OSS Boundary` section:

  ```markdown
  ## 🛡️ OSS Boundaries

  > [!IMPORTANT]
  > **Open-Source Sync Limitations & Boundaries**
  >
  > - **Guest local LAN mode**: Foreground automatic sync does not require account-service state. Devices discover and pair automatically over LAN.
  > - **Read-only Sync Queue**: Users cannot delete, reorder, or skip items via the UI.
  > - **Serial Single-file Upload**: Devices upload only one file at a time.
  > - **No manual picking bypass**: The sync set is strictly driven by background/foreground mobile scans, not checkbox picking.

  > [!WARNING]
  > **Remote/Background Sync Status**
  >
  > Non-OSS remote / background capabilities fail closed. Silent background resume, remote access, and tunnel credentials are disabled without official signing or server-side configurations.
  ```

- [ ] **Step 2: Format the file**
      Run: `pnpm exec prettier --write README.md`
      Expected: Command succeeds.

- [ ] **Step 3: Commit**
      Run: `git commit -am "docs: restructure OSS boundaries using GitHub alerts"`

---

### Task 4: Developer Command Folding & Structure Folding

**Files**:

- Modify: `README.md`

- [ ] **Step 1: Wrap advanced commands and directory structures in details components**
      Move prerequisites, extra compilation rules, project structure, and local packaging commands into separate folding `<details>` elements.

  Prerequisites section update:

  ```markdown
  ## ⚙️ Prerequisites

  - **Node.js** >= 22.12.0
  - **pnpm** >= 10
  - **Go** >= 1.25.6

  <details>
  <summary>🔍 Expand Mobile & OS Platform Prerequisites</summary>

  - **macOS or Windows** (Linux is verification-only)
  - **Xcode + CocoaPods** (iOS builds, macOS only)
  - **Android Studio + Android SDK / NDK** (Android builds)
  </details>
  ```

  Common Commands section update:

  ````markdown
  ## 💻 Common Commands

  ```bash
  # Start desktop development mode
  pnpm dev:desktop
  ```
  ````

  <details>
  <summary>🛠️ View More Developer Commands (Desktop, Mobile, Sidecar)</summary>

  ### Desktop

  ```bash
  pnpm dev:desktop
  pnpm build:desktop
  pnpm package:desktop
  pnpm package:desktop:win
  ```

  ### Mobile

  ```bash
  pnpm dev:mobile
  pnpm build:mobile
  pnpm dev:mobile:android
  pnpm build:mobile:android
  ```

  ### Sidecar

  ```bash
  pnpm dev:sidecar
  pnpm build:sidecar
  pnpm test:sidecar
  ```

  </details>
  ```

  OSS Build and Package Verification section update:

  ````markdown
  <details>
  <summary>📦 View OSS Build & Package Verification Pipelines</summary>

  ```bash
  # Inspect commands that would run
  pnpm release --profile review --targets ios,android,mac,win,linux --dry-run
  # ... (place rest of build commands here)
  ```
  ````

  </details>
  ```

  Project Structure section update:

  ````markdown
  <details>
  <summary>📁 View Repository Directory Structure Tree</summary>

  ```text
  lynavo-drive/
  ├── apps/
  │   ├── desktop/              # Electron desktop app
  ...
  ```
  ````

  </details>
  ```

- [ ] **Step 2: Format the file**
      Run: `pnpm exec prettier --write README.md`
      Expected: Command succeeds.

- [ ] **Step 3: Commit**
      Run: `git commit -am "docs: wrap advanced commands and structures in folding details"`

---

### Task 5: Final Validation & Formatting

**Files**:

- Modify: `README.md`

- [ ] **Step 1: Check document formatting and execute full repository checks**
      Run format and typecheck tasks to verify the changes didn't disrupt any build constraints.

  Run: `pnpm format:check`
  Expected: Success.

  Run: `pnpm typecheck`
  Expected: Success.

- [ ] **Step 2: Commit**
      Run: `git commit -am "docs: final format and validation pass for README"`
