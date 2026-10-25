# Blueprint: Architecture Design

**Status:** Final draft v1 · 25 Oct 2026
**Product:** An interactive platform for learning low-level design (LLD) and system design for software engineering interviews.
**Format of this document:** Every decision lists *what we chose*, *why*, *what we rejected*, and *when to revisit it*.

---

## 1. Goals, scope and non-goals

### 1.1 Goal
Take a learner from "I know the term" to "I can design this on a whiteboard in 45 minutes" through a repeatable loop: **learn → see code → apply on a problem → get feedback → review weak spots.**

### 1.2 MVP scope (what ships)
- Structured lessons with embedded quizzes.
- Problem library with requirements, a hint ladder and reference solutions.
- The **Workbench**: a class-diagram canvas that generates Java and gives rule-based feedback.
- Quizzes and spaced-repetition review.
- Progress tracking per topic.

### 1.3 Non-goals (explicitly out for MVP)
| Non-goal | Why it is out |
|---|---|
| Running user-written Java | Sandboxing untrusted code is a separate security project. The Workbench generates code from the diagram instead. |
| Real-time collaboration | High complexity, low value for solo interview prep. |
| Native mobile apps | A responsive web app covers lessons, quizzes and review. The canvas is best on larger screens. |
| Payments and subscriptions | Product is not monetised yet. Adds compliance and support load. |
| AI feedback | Deferred to phase 4. The rule-based version must work and be trusted first. |

---

## 2. Guiding principles

1. **The diagram is the single source of truth.** Canvas, generated code, checklist ticks, feedback and saved attempts are all derived from one JSON model. This prevents the screens from contradicting each other.
2. **Practice over reading.** Every lesson ends in something the user does.
3. **Pure logic, thin UI.** Model, code generation and analysis are framework-free TypeScript with unit tests. Angular only renders and wires them.
4. **Start simple, keep seams.** Begin with no backend and a modular design, but leave clear boundaries so a backend, a Java port, or a different canvas library can be added without a rewrite.
5. **Be honest about heuristics.** Rule-based feedback catches common mistakes; it cannot judge every valid design. The UI says so.

---

## 3. System overview

```
                      ┌──────────────────────────────────────────────┐
                      │                Angular app                    │
                      │                                               │
  Markdown / JSON ──► │  Lesson renderer   Problem library   Review   │
  content             │         │                 │              │    │
                      │         ▼                 ▼              ▼    │
                      │   ┌───────────────  Workbench  ─────────────┐ │
                      │   │ Canvas (Foblex) ◄─► Diagram store       │ │
                      │   └───────────────────────┬─────────────────┘ │
                      │                           ▼                   │
                      │   ┌───────────── Framework-free libs ───────┐ │
                      │   │ diagram-model · codegen · analyzers     │ │
                      │   └─────────────────────────────────────────┘ │
                      │         │ localStorage / IndexedDB (phase 1-3)│
                      └─────────┼─────────────────────────────────────┘
                                │ REST (phase 4+, OpenAPI client)
                      ┌─────────▼─────────────────────────────────────┐
                      │ Spring Boot modular monolith                   │
                      │ users · attempts · progress · review · ai      │
                      └─────────┬──────────────────────┬──────────────┘
                                ▼                      ▼
                           PostgreSQL            Claude API (phase 5)
```

Data flow inside the Workbench:

```
Diagram JSON ─┬─► Code generator ───► Java tab
              ├─► Rule analyzers ───► Feedback tab
              ├─► Requirement matcher ► Checklist ticks
              └─► Saved attempt (versioned JSON)
```

---

## 4. Decisions

### D1. Architecture style: modular monolith (not microservices)

- **Chose:** One Spring Boot application with clear internal modules (`users`, `content`, `attempts`, `progress`, `review`, `ai`). The frontend is a separate Angular app.
- **Why:**
  - The team is one person; operating many services adds deployment, networking and debugging cost with no benefit at this scale.
  - Module boundaries enforced in code (packages, no cross-module table access) give most of the design benefit.
  - The analysis engine and the AI module are the natural first candidates to extract, and the boundaries already isolate them.
- **Rejected:** Microservices from day one (premature), serverless functions (cold starts and scattered logic for a stateful product), BaaS such as Firebase (limits the backend skills this project is meant to build on).
- **Revisit when:** The AI module needs independent scaling, or a second contributor needs independent deploys.

### D2. Frontend framework: Angular (standalone components, signals)

- **Chose:** Latest stable Angular, standalone components only, signals for state, built-in control flow.
- **Why:**
  - Opinionated structure (DI, routing, forms, HTTP) pairs naturally with a Spring Boot backend and scales well as the app grows.
  - Strong typing end to end with TypeScript.
  - The project doubles as practice on a framework being learned, using a real product with real constraints.
  - Foblex Flow gives a native Angular canvas (see D4).
- **Rejected:**
  - *React/Next.js:* the better-known ecosystem and React Flow are real advantages, but the Angular preference was an explicit goal and a poor reason to avoid learning it.
  - *NgModules:* legacy style; new libraries and docs assume standalone.
  - *SSR for the app shell:* the product sits behind login and is highly interactive, so SSR adds complexity for no gain.
- **Trade-off:** Smaller diagramming ecosystem than React. Mitigated by D4's adapter approach.
- **Revisit when:** Public lesson pages need SEO. Then add Angular SSR or prerendering for those routes only.

### D3. Core model: one versioned diagram JSON

- **Chose:** A plain JSON document (`model` with nodes and edges, a separate `layout`, plus metadata) with a `schemaVersion` field, validated on load, as the only source of truth. The final schema is specified in `diagram-schema.md`, with `diagram.schema.json` and a Parking Lot example.
- **Why:**
  - Everything else (rendering, code, feedback, saved attempts, AI review, reference solutions) becomes a function of this document.
  - Plain JSON is trivially stored in localStorage, Postgres JSONB, or sent to an LLM.
  - Versioning with migration functions lets saved attempts survive schema changes.
- **Rejected:** Letting the canvas library's internal state be the model (couples everything to one library), storing generated Java as the truth (lossy, hard to analyse).
- **Revisit when:** Never as a concept. The schema itself will evolve through `schemaVersion`.

### D4. Canvas: Foblex Flow behind an adapter

- **Chose:** Foblex Flow for rendering and interaction, wrapped in a thin `CanvasAdapter` so the rest of the app never imports it directly.
- **Why:**
  - Angular-native, MIT-licensed, supports zoom and pan, minimap, snapping, SSR and standalone components, and offers layout adapters (Dagre, ELK) and a keyboard accessibility layer.
  - Building a canvas from scratch (drag, connectors, zoom, selection) would take months and is not the product's differentiator.
- **Rejected:** React Flow (not Angular), a hand-built SVG canvas (too costly), ngx-graph (aimed at read-only graph layouts, less suited to editing).
- **Risks:** Small community and likely a single maintainer. UML class boxes with editable members are custom node components regardless of library.
- **Mitigation:**
  1. **One-day spike before committing:** render six UML nodes with edges, minimap, fit-to-view and inline editing.
  2. Keep the diagram JSON as the truth (D3), so the canvas is only a view.
  3. Fallback candidate: JointJS (framework-agnostic and mature).
- **Revisit when:** The spike fails, or maintenance stalls.

### D5. State management: signals plus a command-based diagram store

- **Chose:** Angular signals for UI state. A dedicated `DiagramStore` that applies **commands** (add node, move node, edit member, connect, delete) and keeps an undo/redo stack. NgRx SignalStore is acceptable if a standard structure is preferred.
- **Why:**
  - Undo/redo is a core editing expectation, and commands make it straightforward.
  - Commands are small, testable, and can be replayed.
  - A full NgRx reducer/effects setup is more ceremony than this app needs.
- **Rejected:** Component-local state (cannot support undo or cross-pane sync), global mutable objects.
- **Revisit when:** State grows across many features and needs devtools-level tracing.

### D6. Analysis engine: TypeScript in the browser first

- **Chose:** Rules as pure functions `(diagram, problem) → results`, in a framework-free library. Runs entirely in the browser.
- **Why:**
  - Feedback is instant while the user edits, with no network round trip.
  - Phases 1–3 need no backend.
  - Pure functions are easy to unit test with fixtures.
  - Keeping it framework-free makes a later Java port mechanical.
- **Rejected:**
  - *Java backend from the start:* adds latency to every edit and forces a backend before the product is validated.
  - *LLM-only feedback:* slow, costly and inconsistent. It is used later as a complement, not a base.
- **Rule shape:**
  ```ts
  interface Rule {
    id: string;
    run(d: Diagram, p: Problem): Finding[];
  }
  interface Finding {
    ruleId: string;
    severity: 'pass' | 'warn' | 'fail';
    title: string;
    explanation: string;
    whyItMatters: string;
    nodeIds: string[]; // powers "Show on diagram"
  }
  ```
- **Rule families:** structural (Single Responsibility, Open/Closed heuristics), pattern detectors (Strategy, State, Observer), and per-problem requirement matchers.
- **Honesty requirement:** The UI labels checks as heuristics and always offers a "Why this matters" explanation.
- **Revisit when:** Server-side authority is needed (leaderboards, verified scores) or the AI module needs the same rules. Port then.

### D7. Code generation: deterministic templates

- **Chose:** A generator that converts each node into one Java file using templates.
- **Rules:**
  - One public type per file, with its own package and imports.
  - Names match the diagram exactly.
  - Output is deterministic (same diagram, same code): members in their stored order, stable formatting.
  - Generate only what is on the diagram; never invent classes.
- **Why:** Predictability. Learners trust output that always matches what they drew, and tests can snapshot it.
- **Rejected:** LLM-generated code (non-deterministic, may disagree with the diagram), a single combined file (not valid Java for multiple public types).
- **Revisit when:** Learners want editable code that round-trips back to the diagram. That is a separate, larger feature.

### D8. Lessons and content: Markdown plus JSON, with a block renderer

- **Chose:**
  - Lessons as Markdown files with front matter.
  - Problems, rubrics and quiz questions as JSON, validated against JSON Schema at build time.
  - A lesson renderer that supports a small fixed set of interactive blocks (quiz, Java snippet with tabs, before/after pattern, mini-diagram).
- **Why:**
  - Writing content stays fast and diffable in Git.
  - Content is data, so adding the 40th problem needs no code.
  - Fixed blocks keep the interactive pieces as real, tested Angular components.
- **Rejected:** MDX (React-oriented), a headless CMS (extra service and cost for one author), storing content in the database (harder to review and version).
- **Revisit when:** Multiple authors need a non-technical editing workflow. Then add a CMS.

### D9. UI toolkit: Tailwind plus Angular CDK

- **Chose:** Tailwind for styling and Angular CDK for accessible behaviour (tabs, dialogs, overlays, drag and drop, focus management). Design tokens (colour, type, spacing) live in one place.
- **Why:**
  - The design direction is distinctive (drafting-table feel). A full component library would fight it.
  - CDK provides the hard accessibility parts without imposing a look.
- **Rejected:** Angular Material or PrimeNG as the base look (faster, but visually generic and harder to override); fully custom components from zero (re-solving focus traps and keyboard handling).
- **Revisit when:** Speed matters more than distinctiveness. Material can be adopted for non-core screens.

### D10. Code display: Shiki, read-only

- **Chose:** Shiki for syntax highlighting of generated and lesson code.
- **Why:** Lighter than an embedded editor, themeable, and the generated code is read-only.
- **Rejected:** Monaco (heavy for read-only use).
- **Revisit when:** Code becomes editable. Then adopt Monaco for the Java tab only.

### D11. Persistence by phase

| Phase | Where data lives | Why |
|---|---|---|
| 1–3 | Browser storage (localStorage for progress; IndexedDB if attempts grow large) | Zero backend, fast iteration, works offline. |
| 4+ | PostgreSQL via the API | Accounts, cross-device sync, spaced repetition across sessions. |

- **Migration plan:** On first login, offer to import local progress and attempts to the account. Because attempts are versioned JSON (D3), import is a straight upload.
- **Rejected:** Backend from day one (delays learning whether the content works).

### D12. Backend: Spring Boot 3 on Java 21

- **Chose:** Spring Boot, Spring Security, Spring Data JPA (or jOOQ if queries get complex), Flyway migrations.
- **Why:**
  - It is the author's core stack, so effort goes into the product, not the framework.
  - Mature, production-proven and well documented.
  - Showcases the stack targeted by backend interview roles.
- **Rejected:** Node/Express (would split the author's depth across two stacks), Quarkus/Micronaut (smaller benefit, less familiarity).
- **Revisit when:** Startup time or memory becomes a cost problem. Consider native image or a lighter runtime.

### D13. Database: PostgreSQL with JSONB for diagrams

- **Chose:** PostgreSQL. Relational tables for users, progress and review; JSONB for diagrams and reference solutions. Flyway for migrations.
- **Why:**
  - The data is relational (users → attempts → hint usage → progress).
  - JSONB stores flexible diagram documents without losing SQL for everything else.
  - Strong transactional guarantees for spaced-repetition updates.
- **Rejected:** MongoDB (loses relational integrity for progress data), SQLite (limits concurrency and hosting choices).
- **Core tables:** `users`, `tracks`, `lessons`, `problems`, `attempts`, `hint_usage`, `quiz_questions`, `answers`, `review_cards`, `progress`.
  - Content tables are an index; the content itself is synced from the Git repository.
- **Revisit when:** Read load grows. Add read replicas or Redis caching (D17).

### D14. Authentication: OAuth only

- **Chose:** Sign in with Google and GitHub through Spring Security OAuth2 login. No passwords.
- **Why:** No password storage, reset flows or credential-stuffing risk; target users already have these accounts; much less code.
- **Rejected:** Own email/password (security burden), third-party auth SaaS (cost and lock-in for a small need).
- **Revisit when:** Users without Google or GitHub accounts become a meaningful group. Add email magic links.

### D15. API contract: OpenAPI with a generated TypeScript client

- **Chose:** springdoc-generated OpenAPI spec from the Spring Boot code. The Angular client and types are generated from it in CI.
- **Why:** Java and TypeScript types cannot drift; breaking changes fail the build; less hand-written HTTP code.
- **Rejected:** Hand-written clients (drift), GraphQL (more infrastructure than simple CRUD needs).
- **Revisit when:** Clients multiply or the data needs become highly varied per screen.

### D16. Spaced repetition: SM-2

- **Chose:** The SM-2 algorithm, with `ease`, `interval` and `due_date` per review card. Missed quiz questions and weak analyser findings create cards automatically.
- **Why:** Simple, well understood and proven. Easy to implement and test.
- **Rejected:** FSRS (better scheduling, but more complex and unnecessary at MVP).
- **Revisit when:** Review accuracy becomes a measurable product concern.

### D17. Caching

- **Chose:** No cache in the MVP. Add Redis only when measurements show a need.
- **Why:** Content is static and served as files; per-user data is small. Adding Redis now would be unmeasured complexity.
- **Revisit when:** The AI module needs result caching or per-user rate limiting at scale.

### D18. AI feedback (phase 5)

- **Chose:** The Claude API, called from the Spring Boot `ai` module, never from the browser.
- **Input:** Diagram JSON, the problem's rubric and the reference solution.
- **Output:** Structured JSON: strengths, gaps, and one guiding question.
- **Guardrails:**
  - Rule-based findings are shown first; AI is a complement.
  - Per-user rate limiting, using the author's own distributed rate limiter.
  - Cache by hash of (diagram, problem, rubric version) to avoid repeat cost.
  - The API key stays server-side.
  - Output is validated against a schema before display.
- **Why:** The rubric and reference grounding keep results consistent. Server-side calls protect the key and control cost.
- **Rejected:** Browser-side calls (key exposure), AI as the only feedback (cost, latency, inconsistency).
- **Revisit when:** Per-attempt cost exceeds what the product can sustain.

### D19. Testing strategy

| Layer | Tool | What it covers |
|---|---|---|
| Framework-free libs | Vitest or Jest | Every rule, code generator snapshots, command undo/redo, schema migrations. This is the highest-value test layer. |
| Angular components | Angular Testing Library style tests | Lesson renderer, quiz blocks, feedback panel. |
| Backend | JUnit + Testcontainers (real Postgres) | Repositories, API, SM-2 scheduling. |
| End to end | Playwright | Full flow: open problem → draw → get feedback → check requirements. |
| Accessibility | axe checks in Playwright | WCAG 2.1 AA regressions. |

- **Why:** Most product risk sits in the pure libraries; testing them heavily is cheap and catches the worst bugs (wrong feedback).

### D20. Accessibility

- **Chose:** WCAG 2.1 AA as the floor.
- **Specifics:** Keyboard-operable canvas (move, connect, edit); an **Outline view** listing nodes and relationships as text for screen readers; visible focus rings; status never conveyed by colour alone; 44px touch targets on tablet.
- **Why:** It is both the right thing to do and a differentiator for a tool with a visual core.

### D21. Security

- **Chose:**
  - No execution of user code anywhere (see non-goals).
  - Markdown sanitised before rendering.
  - OAuth only; session cookies are HttpOnly, Secure and SameSite.
  - Strict CORS and a Content Security Policy.
  - Secrets in environment configuration, never in the repo.
  - Rate limiting on all write and AI endpoints.
  - Input size limits on diagram uploads.
- **Why:** The attack surface stays small by design; the biggest risks (code execution, password storage) are avoided entirely.

### D22. Delivery, CI/CD and hosting

- **Chose:**
  - Docker for the backend; GitHub Actions for build, test, lint, OpenAPI client generation and deploy.
  - Phase 1–3 (static): the Angular build deployed to a static host (Azure Static Web Apps, Netlify or Vercel).
  - Phase 4+: backend as a container on Azure Container Apps or App Service, with Azure Database for PostgreSQL. Alternatives: Railway or Fly.io for lower cost.
- **Why:** Static hosting is free or near-free for the early phases; the container path is portable across hosts, and Azure usage doubles as cloud practice.
- **Rejected:** Kubernetes (operational overhead without need), self-managed VMs (maintenance burden).
- **Revisit when:** Traffic or cost justifies changing the platform.

### D23. Observability

- **Chose:** Structured logs, Spring Boot Actuator health and metrics, error tracking on both sides (for example Sentry), and basic privacy-respecting product analytics (completion rates, hint usage, where learners abandon).
- **Why:** The analytics decide what content to improve, which matters more than infrastructure dashboards at this stage.

### D24. Repository and project structure

- **Chose:** Two repositories: `blueprint-web` (Angular) and `blueprint-api` (Spring Boot, created in phase 4). Content lives inside `blueprint-web` initially.
- **Why:** The backend does not exist yet; a monorepo adds tooling for no benefit. The structure inside the web repo protects the important boundary:

```
blueprint-web/
  src/app/
    core/            auth, http, storage, layout shell
    features/
      dashboard/
      learn/         tracks, lesson renderer, quiz blocks
      problems/      library, filters, problem page
      workbench/     canvas adapter, requirement panel, feedback tabs
      review/        flashcards, spaced repetition
  src/lib/           framework-free TypeScript (no Angular imports)
    diagram-model/   types, validation, commands, migrations
    codegen/         diagram → Java files
    analyzers/       rules, pattern detectors, requirement matchers
  content/
    lessons/*.md
    problems/*.json
    questions/*.json
```

- **Enforcement:** A lint rule forbids `src/lib/**` from importing Angular, so the libraries stay portable.

---

## 5. Content strategy

Content is the largest cost in this project, so it gets its own plan.

- **Target:** 40 problems with rubrics, 10 patterns, 15 system-design building blocks, 200 quiz questions over time.
- **Problem definition** includes: requirements, entities, a rubric, a four-rung hint ladder (nudge, approach, structure, near-solution), a reference diagram, common mistakes, and the matcher ids that decide when a requirement counts as covered.
- **Quality gate:** Each problem's reference diagram must pass its own analyzers; this is a test in CI, so the content and the rules cannot disagree.
- **Order of authoring:** Parking Lot, Vending Machine, Elevator, then expand. Three excellent problems beat twenty thin ones.

---

## 6. Delivery plan

| Phase | Deliverable | Backend? |
|---|---|---|
| **0** | Foblex spike (one day), diagram schema finalised | No |
| **1** | Content app: lessons, quizzes, problem pages, progress in browser storage | No |
| **2** | `diagram-model`, `codegen` and `analyzers` as tested libraries, then the Workbench for 3 problems | No |
| **3** | Hint ladder, requirement matching, reference comparison, Outline view, accessibility pass | No |
| **4** | Spring Boot API, PostgreSQL, OAuth, saved attempts, spaced repetition, local-data import | Yes |
| **5** | AI feedback, mock interview mode, more problems, system design studio | Yes |

Phase 1 doubles as Angular practice (routing, services, signals, forms) before the harder Workbench work in phase 2.

---

## 7. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Content takes longer than code | Product feels thin | Ship three excellent problems first; treat content as the main workstream. |
| Canvas library is limiting or abandoned | Rework of the Workbench | Day-one spike, adapter boundary, JSON as truth, JointJS fallback. |
| Rule-based feedback is wrong or too strict | Learners lose trust | Heuristic labelling, "Why this matters", severity levels, fixture-based tests, easy feedback reporting. |
| Scope creep from the mockups | Nothing ships | The phase plan is the contract; new ideas go to a backlog. |
| Angular learning curve slows the Workbench | Delay | Do phase 1 first; keep logic in plain TypeScript. |
| AI cost or inconsistency (phase 5) | Budget and quality | Rubric grounding, caching, rate limiting, schema-validated output. |

---

## 8. Open questions

1. ~~Final shape of the diagram JSON~~ Settled in `diagram-schema.md`.
2. Which three problems get the first reference solutions and matchers.
3. Whether the product is for personal use only or will be published, which decides how soon accounts and hosting matter.
4. Name and domain, if published.

---

## Appendix A: Draft diagram schema (superseded)

> **Superseded by `diagram-schema.md` (final v1).** Main changes: layout moved out of nodes, members have ids, constructors are modelled, types follow a defined grammar. The draft below is kept for history only.

```json
{
  "schemaVersion": 1,
  "problemId": "parking-lot",
  "nodes": [
    {
      "id": "n_parkinglot",
      "kind": "class",
      "name": "ParkingLot",
      "stereotype": null,
      "fields": [
        { "name": "floors", "type": "List<ParkingFloor>", "visibility": "private" },
        { "name": "pricingStrategy", "type": "PricingStrategy", "visibility": "private" }
      ],
      "methods": [
        {
          "name": "parkVehicle",
          "params": [{ "name": "v", "type": "Vehicle" }],
          "returns": "Ticket",
          "visibility": "public"
        }
      ],
      "position": { "x": 0, "y": 0 }
    }
  ],
  "edges": [
    {
      "id": "e_1",
      "kind": "composition",
      "from": "n_parkinglot",
      "to": "n_parkingfloor",
      "fromCardinality": "1",
      "toCardinality": "1..*",
      "label": ""
    }
  ]
}
```

- `kind` for nodes: `class | abstract | interface | enum`.
- `kind` for edges: `association | composition | aggregation | inheritance | implementation | dependency`.
- Positions are stored but never used by analyzers, so layout changes cannot change feedback.
- IDs are stable and never reused, so "Show on diagram" and saved attempts stay valid.

## Appendix B: Decision summary

| # | Decision | Choice |
|---|---|---|
| D1 | Architecture style | Modular monolith |
| D2 | Frontend | Angular, standalone, signals |
| D3 | Source of truth | Versioned diagram JSON |
| D4 | Canvas | Foblex Flow behind an adapter (after a spike) |
| D5 | State | Signals plus command-based store with undo/redo |
| D6 | Analysis engine | Pure TypeScript, in the browser first |
| D7 | Code generation | Deterministic templates, one public type per file |
| D8 | Content | Markdown plus JSON, fixed interactive blocks |
| D9 | UI | Tailwind plus Angular CDK |
| D10 | Code display | Shiki, read-only |
| D11 | Persistence | Browser storage first, PostgreSQL from phase 4 |
| D12 | Backend | Spring Boot 3, Java 21 |
| D13 | Database | PostgreSQL with JSONB |
| D14 | Auth | OAuth (Google, GitHub) |
| D15 | API contract | OpenAPI with generated TypeScript client |
| D16 | Spaced repetition | SM-2 |
| D17 | Caching | None until measured |
| D18 | AI feedback | Claude API, server-side, rubric-grounded, phase 5 |
| D19 | Testing | Vitest/Jest, Testcontainers, Playwright, axe |
| D20 | Accessibility | WCAG 2.1 AA, keyboard canvas, Outline view |
| D21 | Security | No code execution, sanitised content, OAuth only |
| D22 | Delivery | Docker, GitHub Actions, static host then Azure |
| D23 | Observability | Logs, Actuator, error tracking, product analytics |
| D24 | Repos | `blueprint-web`, then `blueprint-api` |
