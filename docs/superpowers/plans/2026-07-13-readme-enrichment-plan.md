# README.md Community Enrichment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**: Enrich the `README.md` with "FAQs & Troubleshooting" and "Contributing" sections tailored to the open-source community.

**Architecture**: Insert folded FAQ details after the Quick Start section and add a Contributing Guide before the License section.

**Tech Stack**: Markdown, HTML, Prettier.

---

### Task 1: FAQs & Troubleshooting Section

**Files**:
- Modify: `README.md` (after Quick Start section)

- [ ] **Step 1: Insert folded FAQ block**
  Open `README.md` and locate the end of the `## 🚀 Quick Start` section. Right after it, insert the `## ❓ FAQs & Troubleshooting` block containing common issues (mDNS discovery, iCloud download state, manual sync constraints, sleep/reconnect logic) inside a folded detail component.
  
  Insert code:
  ```markdown
  ## ❓ FAQs & Troubleshooting

  <details>
  <summary>🔍 View Troubleshooting Guide & Common FAQs</summary>

  ### 1. The mobile app cannot find my desktop client (mDNS discovery failure)
  - **Check Network**: Ensure both mobile and desktop are on the same Local LAN (or VPN-LAN).
  - **Windows Firewall**: Verify that Windows Defender Firewall allows incoming traffic for ports `39393` (TCP/LMUP file transport) and `39394` (HTTP API).
  - **Bonjour Runtime**: The OSS build doesn't redistribute Apple Bonjour. Ensure Bonjour is installed on Windows, or rely on the zeroconf-compatible fallback.

  ### 2. Why are some of my iCloud photos stuck/not transferring?
  - Photos marked with `iCloud` must be exported from the Apple Photos cloud repository before transfer. 
  - While in `cloud_downloading` or `preparing` states, the phone is downloading the high-res original asset to local storage. Transfer begins automatically once complete.

  ### 3. Can I manually select which photos/videos to sync?
  - No. To ensure fully automatic incremental sync, Lynavo Drive relies entirely on mobile background/foreground scans and a strictly read-only pending queue. Checkbox picking is a non-goal for this baseline.

  ### 4. What happens when the desktop sleeps or connection drops?
  - LAN transfers will interrupt. Once the desktop wakes and network connectivity is restored, the mobile app will automatically resume the unfinished queue without losing progress.
  - Enable *"Prevent computer from sleeping while syncing"* in the desktop app settings for uninterrupted transfers.

  </details>
  ```

- [ ] **Step 2: Format README**
  Run: `pnpm exec prettier --write README.md`
  Expected: Command succeeds.

- [ ] **Step 3: Commit changes**
  Run: `git commit -am "docs: add FAQs and Troubleshooting section to README"`

---

### Task 2: Contributing Section

**Files**:
- Modify: `README.md` (before License section)

- [ ] **Step 1: Insert Contributing Guide**
  Open `README.md` and locate the end of the `## 📄 Documentation Reference` section (right before `## ⚖️ License`). Insert the `## 💡 Contributing` guide with the fork, install, build, and test steps.
  
  Insert code:
  ```markdown
  ## 💡 Contributing

  We welcome contributions from the community! To get started:

  1. **Fork the Repository**: Create a personal fork and clone it locally.
  2. **Setup Development Workspace**: Install dependencies and compile shared packages:
     ```bash
     pnpm install
     pnpm build
     ```
  3. **Verify Tests**: Ensure all formatting, typescript checks, and unit tests pass before submitting a PR:
     ```bash
     pnpm test
     pnpm typecheck
     pnpm format:check
     ```

  For detailed coding standards, project layouts, and process rules, check out our [Contributing Guidelines](./CONTRIBUTING.md) and [Code of Conduct](./CODE_OF_CONDUCT.md).
  ```

- [ ] **Step 2: Format README**
  Run: `pnpm exec prettier --write README.md`
  Expected: Command succeeds.

- [ ] **Step 3: Commit changes**
  Run: `git commit -am "docs: add Contributing section to README"`

---

### Task 3: Final Format & Verification

**Files**:
- Modify: `README.md`

- [ ] **Step 1: Run validation pipeline**
  Run: `pnpm format:check`
  Expected: Success.
  
  Run: `pnpm typecheck`
  Expected: Success.

- [ ] **Step 2: Commit final format changes**
  Run: `git commit -am "docs: final formatting pass for enriched README"`
