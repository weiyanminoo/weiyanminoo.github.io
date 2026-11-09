---
org: Influencees
role: Founding Engineer
discipline: Product and AI
start: 2026-09-01
end: null
current: true
depth: 6
summary: Leading product for a platform connecting creators and brands.
tags: [Product, AI, Roadmap]
---

- Built the platform's **CI pipeline** and **production monitoring** from scratch: **GitHub Actions** checks (type-check, ESLint, Vitest) on every PR, the codebase's first test suites (~**2,700 tests**), and real-time crash alerts for payment, sign-in and scheduled-job failures, replacing manual log checks.
- Built in-house **product analytics** across creator, brand and agency dashboards; used the data to choose a **Telegram AI assistant** over a native mobile app, then shipped it end to end, and it became the **most-used feature** within its first week.
- Rebuilt the integration with a paid **third-party social-data API** into one shared client with failure reporting, backup requests for slow calls, parallel fetching and caching, **cutting latency by 40%**, and removed a debug endpoint that spent paid calls on every page visit.
