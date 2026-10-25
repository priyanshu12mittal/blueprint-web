# Architectural Decision Records (ADRs) & Project Log

This document records the architectural and engineering decisions made throughout the lifecycle of the **Blueprint** project. It serves as a continuous record of *what* was chosen, *why*, *alternatives rejected*, and *impact*.

---

## Foundational Decisions (from Architecture Design)

| ID | Title | Summary Choice |
|---|---|---|
| **D1** | Architecture Style | **Modular Monolith** (Spring Boot 3 in Phase 4; Angular frontend). Microservices rejected as premature overhead. |
| **D2** | Frontend Framework | **Angular 21** with standalone components, Signals, control flow syntax, and SCSS. |
| **D3** | Core Model (Single Truth) | **One versioned Diagram JSON document** (`schemaVersion`, `meta`, `settings`, `model`, `layout`). |
| **D4** | Canvas Technology | **Foblex Flow** behind an adapter interface; diagram JSON is the sole source of truth. |
| **D5** | State Management | **Signals + Command-based Diagram Store** with full undo/redo stack. |
| **D6** | Analysis Engine | **Framework-free TypeScript in browser first**. Rules modeled as pure functions `(diagram, problem) -> Finding[]`. |
| **D7** | Code Generation | **Deterministic string templates** producing one public Java type per file. |
| **D8** | Content Strategy | **Markdown + JSON** for problems/rubrics/quizzes, validated against JSON Schema at build time. |
| **D9** | UI Toolkit | **Tailwind CSS + Angular CDK** for accessible behaviors without design lock-in. |
| **D10** | Code Display | **Shiki** for syntax highlighting (read-only in early phases). |
| **D11** | Persistence by Phase | Browser storage (`localStorage` / `IndexedDB`) for Phases 1–3; PostgreSQL for Phase 4+. |
| **D12** | Backend Stack | **Spring Boot 3 + Java 21** with Spring Data JPA and Flyway (Phase 4). |
| **D13** | Database | **PostgreSQL** with JSONB columns for diagram documents. |
| **D14** | Authentication | **OAuth2 only** (Google & GitHub). No custom password storage. |
| **D15** | API Contract | **OpenAPI** via springdoc with generated TypeScript client for Angular. |
| **D16** | Spaced Repetition | **SM-2 algorithm** for flashcard reviews derived from quiz misses and weak analyzer findings. |
| **D17** | Caching | None until measured. Redis deferred until AI/rate-limiting requires it. |
| **D18** | AI Feedback | **Claude API** server-side in Phase 5, rubric-grounded and cached by model hash. |
| **D19** | Testing Strategy | High-coverage unit tests for `src/lib/**` via Vitest; Angular component tests; Testcontainers for backend; Playwright for E2E. |
| **D20** | Accessibility | **WCAG 2.1 AA**, keyboard-navigable canvas, and structured Outline view for screen readers. |
| **D21** | Security | No server-side or client-side execution of user Java code; strict sanitization and CSP. |
| **D22** | Delivery & CI/CD | GitHub Actions running lint, typecheck, and tests; static hosting for early phases. |
| **D23** | Observability | Structured logging, Actuator health endpoints, privacy-preserving learner analytics. |
| **D24** | Repository Structure | `blueprint-web` (Angular) and `blueprint-api` (Spring Boot). Separation enforced by lint boundaries. |

---

## Phase 0: Setup & Spikes

### ADR-001: Separation of `src/lib` via ESLint boundary
- **Context:** `src/lib/` contains the core business logic (`diagram-model`, `codegen`, `analyzers`). If an engineer or LLM imports `@angular/*` into `src/lib/`, the core model becomes coupled to the frontend framework and cannot be easily tested headless, run in Node, or ported to Java.
- **Decision:** Enforce an ESLint rule `no-restricted-imports` with `patterns: ['@angular/*']` specifically on `src/lib/**/*.ts`.
- **Status:** Accepted & Verified. Tested with an intentional `@angular/core` import in `src/lib/diagram-model/diagram-model.spec.ts`, which failed linting with `no-restricted-imports`.

### ADR-002: Dedicated Vitest Runner for `src/lib`
- **Context:** Angular testing setups (even with modern builders) can incur Angular TestBed overhead or DOM mocks. The domain logic in `src/lib` consists of pure mathematical and data transformation functions (`(model) -> JavaCode`, `(model) -> Findings`).
- **Decision:** Run Vitest directly on `src/lib/**/*.spec.ts` in headless node environment for sub-second test feedback.
- **Status:** Accepted & Verified. Smoke test runs in ~140ms via `npm run test:lib`.

### ADR-003: CI Workflow with Combined Lint, Framework-Free Tests, and Build
- **Context:** Protect code quality, boundary enforcement, and application compilation automatically on every commit/PR.
- **Decision:** Use GitHub Actions (`.github/workflows/ci.yml`) on Node 22 running:
  1. `npm ci`
  2. `npm run lint` (validates boundary rules)
  3. `npm run test:lib` (fast domain logic tests via Vitest)
  4. `npm test -- --watch=false` (Angular unit tests)
  5. `npm run build` (production build verification)
- **Status:** Accepted.
