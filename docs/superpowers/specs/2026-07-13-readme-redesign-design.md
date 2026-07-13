# Design Spec: README.md Redesign for Lynavo Drive

**Date**: 2026-07-13  
**Status**: Proposed (Pending User Review)

---

## 1. Project Context & Objectives

The `codex/lynavo-global-oss-commercial-plan` branch serves as the open-source base for **Lynavo Drive** (a local-LAN incremental media sync tool from mobile to desktop).
To make this OSS repository visually striking and professionally structured, we will redesign the `README.md`.

Our goals are:

- Introduce `screenshots/banner.png` and `screenshots/logo.png` at the top with center alignment.
- Incorporate a clean visual grid showcase for `screenshots/screenshot_1.png` through `screenshots/screenshot_5.png` with contextual titles.
- Restructure documentation hierarchy to prioritize readability, utilizing folding `<details>` components for developer-only or validation CLI command groups.
- Emphasize the OSS boundaries and key features using GitHub-native blockquotes/alerts.

---

## 2. Visual Layout Design

### 2.1 Hero Section

- **Banner**: `screenshots/banner.png` stretched to `100%` width at the top.
- **Logo**: `screenshots/logo.png` centered at `120px` width.
- **Badges**: Standard shields.io shields:
  - Node.js support (`Node.js >= 22.12.0`)
  - Go support (`Go >= 1.25.6`)
  - Platform support (`macOS | Windows | iOS | Android`)
  - License (`License: MIT`)
- **Navigation Links**: Quick links to key sections (e.g., Features, Quick Start, Screenshots, OSS Boundary, Architecture, Tech Stack).

### 2.2 Screenshots Grid

We will place a 2-row HTML table under the main introduction to display thumbnails of the application screens:

- **Screenshot 1**: `Device Discovery & Pairing` (mDNS network scanning and local link setup)
- **Screenshot 2**: `Mobile Photo Library Scan` (incremental scan and change detection)
- **Screenshot 3**: `Active Sync Queue` (real-time single-file serial upload tracking)
- **Screenshot 4**: `Sync History & Statistics` (completed transfers, daily completion stats)
- **Screenshot 5**: `Desktop Config & Settings` (shared directory configuration)

The HTML layout will render thumbnails with `300px` width so they align neatly.

---

## 3. Structural Sections

### 3.1 Content Flow

1. **Hero Header** (Banner, Logo, Badges)
2. **Project Introduction & Current Status**
3. **Screenshots Preview** (HTML Table grid)
4. **Key Features & OSS Boundaries** (using blockquote alerts)
5. **Quick Start** (simple installation and dev startup commands)
6. **Developer Tools & Commands** (wrapped in `<details>` to prevent clutter)
   - Prerequisite Check
   - Desktop packaging commands (`package:desktop`, `package:desktop:win`)
   - Sidecar testing & validation
   - Release profile commands (`pnpm release`)
7. **Tech Stack & Architecture** (modernized Markdown table & ASCII architecture diagram)
8. **File Directory & Project Structure** (visual tree map)
9. **License & Contribution**

### 3.2 Folding Layouts

We will use HTML `<details>` and `<summary>` tags to fold the following developer-heavy sections:

- `Prerequisites` (except for major Node/Go targets)
- `Common Commands` (except for the 3 basic Quick Start commands)
- `OSS Build and Package Verification` (advanced CI/CD build scripts)
- `Project Structure` (source folder directory layout)

---

## 4. Verification & Testing

Since this is a markdown document modification, verification will consist of:

- Ensuring all image paths are relative and correct (`./screenshots/...`).
- Validating the HTML formatting (unclosed tags in `<details>` or table elements can break GitHub markdown rendering).
- Verifying local build and test commands do not get broken or modified in text snippets.
