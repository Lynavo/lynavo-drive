# Design Spec: README.md Enrichment for Open-Source Community

**Date**: 2026-07-13  
**Status**: Proposed (Pending User Review)

---

## 1. Project Context & Objectives

To support the open-source community around **Lynavo Drive**, we will enrich `README.md` with:

- **Quick Troubleshooting & FAQ** section: Resolving the most common LAN network/mDNS discovery and asset sync questions to offload duplicate GitHub issues.
- **Contributing Guide** section: Making it friendly and friction-free for external contributors to spin up development.

---

## 2. Visual and Structural Layout

### 2.1 Quick Troubleshooting & FAQ Section

- **Location**: Placed right below the `## 🚀 Quick Start` section.
- **Style**: Nested in a `<details>` fold labeled `❓ Quick Troubleshooting & FAQs`.
- **Content**:
  1. ** mDNS / Device Discovery failure**: Pointing to Windows firewall rules, Bonjour Runtime runtime fallback, and same-LAN/VPN-LAN connection status.
  2. ** Stuck iCloud photos**: Explaining `cloud_downloading` state at export.
  3. ** Manual selection request**: Clarifying the read-only queue constraints and why manual checkboxes are non-goals.
  4. ** Auto-resume logic**: Sleep recovery and connection drops.

### 2.2 Contributing Section

- **Location**: Placed at the end, right above the `## ⚖️ License` section.
- **Style**: Decorated with 💡 emoji. Includes a clean 3-step quickstart workflow for external contributors.
- **Content**:
  1. Fork & clone.
  2. Workspace setup (`pnpm install && pnpm build`).
  3. Pre-flight tests validation (`pnpm test && pnpm typecheck`) before submitting Pull Requests.
  4. Links to `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`.

---

## 3. Planned Changes to README.md

### 3.1 FAQ Block

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
- Enable _"Prevent computer from sleeping while syncing"_ in the desktop app settings for uninterrupted transfers.

</details>
```

### 3.2 Contributing Block

````markdown
## 💡 Contributing

We welcome contributions from the community! To get started:

1. **Fork the Repository**: Create a personal fork and clone it locally.
2. **Setup Development Workspace**: Install dependencies and compile shared packages:
   ```bash
   pnpm install
   pnpm build
   ```
````

3. **Verify Tests**: Ensure all formatting, typescript checks, and unit tests pass before submitting a PR:
   ```bash
   pnpm test
   pnpm typecheck
   pnpm format:check
   ```

For detailed coding standards, project layouts, and process rules, check out our [Contributing Guidelines](./CONTRIBUTING.md) and [Code of Conduct](./CODE_OF_CONDUCT.md).

```

```
