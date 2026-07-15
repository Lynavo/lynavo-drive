# Design Spec: README.md Translation (Traditional Chinese)

**Date**: 2026-07-13  
**Status**: Proposed (Pending User Review)

---

## 1. Project Context & Objectives

To support Traditional Chinese (zh-Hant) developers and users in the open-source community, we will create a Traditional Chinese translation of the project landing page.

Our objectives are:

- Create `README.zh-Hant.md` in the repository root.
- Keep the structure, HTML layout, images, details fold components, and commands identical to the English `README.md` (which is in the revised golden order).
- Add language switcher navigation links at the top of both `README.md` and `README.zh-Hant.md`.
- Ensure accurate terminology translation for networking and systems concepts.

---

## 2. Terminology Mapping

To maintain high technical quality, the translation will use standard Traditional Chinese computer science terminology:

- **local-LAN**: 區域網路 (LAN)
- **incremental sync**: 增量同步
- **sidecar**: 側車服務 (Sidecar)
- **fail-open**: 故障開啟 (Fail-open) / 寬鬆放行
- **fail-closed**: 故障關閉 (Fail-closed) / 嚴格阻斷
- **queue / pending queue**: 佇列 / 待處理佇列
- **mDNS / zeroconf discovery**: mDNS / zeroconf 設備發現
- **desktop / mobile**: 桌面端 / 行動端
- **foreground / background**: 前台 / 後台
- **pairing**: 配對
- **untracked files**: 未追蹤檔案
- **release channels**: 發行管道

---

## 3. Language Switcher Header Layout

We will inject a language switcher at the top of both files:

```html
<p align="center"><a href="./README.md">English</a> | <strong>繁體中文</strong></p>
```

_(In `README.md`, English will be plain text and Traditional Chinese will be a link, and vice versa)_

---

## 4. Hierarchy of README.zh-Hant.md

The section structure will translate directly to:

1. **Hero Header (置中橫幅、Logo、多語系連結、徽章、導航連結)**
2. **目前狀態 (Current Status)**
3. **📸 截圖預覽 (Screenshots Preview - HTML Table)**
4. **🛡️ 開源邊界 (OSS Boundaries - HTML Alerts)**
5. **🚀 快速開始 (Quick Start)**
6. **❓ 常見問題與疑難排解 (FAQs & Troubleshooting - folded)**
7. **🛠️ 技術棧 (Tech Stack - Markdown Table)**
8. **🏗️ 架構概述 (Architecture Overview - folded diagram)**
9. **⚙️ 前置需求 (Prerequisites - folded)**
10. **💻 常用指令 (Common Commands - folded)**
11. **📦 開源編譯與打包驗證 (OSS Build & Package Verification - folded)**
12. **📁 專案結構 (Project Structure - folded tree)**
13. **🎯 開源基準線限制 (Development Baseline)**
14. **📄 文件參考與檔案連結 (Documentation Reference)**
15. **💡 參與貢獻 (Contributing)**
16. **⚖️ 授權 (License)**
