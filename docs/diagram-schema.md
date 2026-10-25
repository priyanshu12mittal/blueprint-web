# Blueprint: Diagram Schema v1

**Status:** Final v1 · 25 Oct 2026
**Companion files:** `diagram.schema.json` (machine-readable schema) · `parking-lot.reference.json` (worked example)
**Implements:** Decision D3 in `architecture-design.md`

The diagram document is the single source of truth. The canvas, the generated Java, the requirement checklist, the feedback, saved attempts and (later) AI review are all functions of it. This file records what the document contains, the rules it must obey, and why.

---

## 1. Changes from the draft in the architecture doc

| Draft | Final | Why |
|---|---|---|
| `position` stored on each node | Moved to a separate `layout` section | Dragging a box must never change the semantic hash, trigger re-analysis, or invalidate a cached AI review. |
| Members had no ids | Every field, method and constructor has a stable `id` | "Show on diagram" can highlight a single member, and renaming a member does not break references. |
| Constructors not modelled | Separate `constructors` array | Strategy and Builder examples need them, and they are not methods (no return type). |
| Types were loosely described | Types are strings with a defined grammar and a registry of known JDK types | Readable, editable inline, easy to send to an LLM, and still checkable. |
| One validation step | Three layers (structure, semantics, analyzers) | Drafts are often half-finished; the model must stay loadable while the user is mid-edit. |

---

## 2. Document shape

```
Diagram
├─ schemaVersion   integer, currently 1
├─ meta            problemId, title, createdAt, updatedAt
├─ settings        basePackage (used by code generation)
├─ model           ← the semantic part; the only part that is hashed
│   ├─ nodes[]     class | abstract | interface | enum
│   │    ├─ fields[], methods[], constructors[]   (or constants[] for enums)
│   └─ edges[]     association | aggregation | composition |
│                  inheritance | implementation | dependency
└─ layout          nodes: { [nodeId]: { x, y } }   ← presentation only
```

### TypeScript types (the shape `diagram-model` exports)

```ts
export type Visibility = 'public' | 'private' | 'protected' | 'package';
export type NodeKind = 'class' | 'abstract' | 'interface' | 'enum';
export type EdgeKind =
  | 'association' | 'aggregation' | 'composition'
  | 'inheritance' | 'implementation' | 'dependency';

export interface Param { name: string; type: string }
export interface Field {
  id: string; name: string; type: string;
  visibility?: Visibility;          // default 'private'
  static?: boolean; final?: boolean;
}
export interface Method {
  id: string; name: string; returns: string; params?: Param[];
  visibility?: Visibility;          // default 'public'
  static?: boolean; abstract?: boolean;
}
export interface Ctor { id: string; params?: Param[]; visibility?: Visibility }

export interface DiagramNode {
  id: string; kind: NodeKind; name: string;
  stereotype?: string | null;       // display only, never analysed
  package?: string;                 // sub-package under settings.basePackage
  fields?: Field[]; methods?: Method[]; constructors?: Ctor[];
  constants?: string[];             // enums only, required for enums
}
export interface DiagramEdge {
  id: string; kind: EdgeKind; from: string; to: string;
  fromCardinality?: string; toCardinality?: string;   // association-like only
  label?: string;
}
export interface Diagram {
  schemaVersion: 1;
  meta: { problemId: string; title?: string; createdAt?: string; updatedAt: string };
  settings?: { basePackage?: string };
  model: { nodes: DiagramNode[]; edges: DiagramEdge[] };
  layout: { nodes: Record<string, { x: number; y: number }> };
}
```

On load, the library **normalises**: missing `fields`, `methods`, `constructors` and `params` become empty arrays, and default visibilities are filled in. Everything downstream can then assume the arrays exist.

---

## 3. Decisions

### S1. Layout is separate from the model
- **Chose:** `layout` sits beside `model`, never inside nodes.
- **Why:** Analysis, hashing, AI caching and "has the design changed?" checks should depend on meaning only.
- **Consequence:** `MoveNode` commands touch `layout`, so they support undo but never invalidate feedback.

### S2. Ids are opaque, stable and never reused
- **Chose:** Every node, member and edge has an id matching `^[A-Za-z0-9_.:-]{1,64}$`. The app generates them (for example a short random suffix) and never derives them from names.
- **Why:** Renaming `PricingStrategy` must not break "Show on diagram", saved attempts or feedback history. Ids are never reused within a document, even after deletion.
- **Rejected:** Using names as ids (rename breaks everything), array indexes (reordering breaks everything).

### S3. Names are unique per diagram and must be valid Java identifiers
- **Chose:** Node names are unique and must be legal, non-keyword Java identifiers. Style (PascalCase for types, camelCase for members, UPPER_SNAKE for enum constants) is a warning, not an error.
- **Why:** Code generation needs valid unique type names to produce one file per type. Style stays a teaching point instead of a blocker.

### S4. Types are strings with a defined grammar
- **Chose:** A type is a string such as `String`, `int`, `List<ParkingFloor>`, `Map<VehicleType, List<ParkingSpot>>` or `Ticket[]`. `diagram-model` exports `parseType()` returning `{ base, args, isArray }`.
- **Grammar:**
  ```
  type   := name [ '<' type (',' type)* '>' ] ( '[]' )*
  name   := Java identifier
  ```
- **Resolution:** A type name resolves if it is a node name in the diagram, a primitive, or in the **JDK type registry**, a data file that also maps names to import statements for codegen. The initial registry covers: primitives and `void`; `String`, `Object` and the boxed types; `BigDecimal`, `BigInteger`; `Instant`, `Duration`, `LocalDate`, `LocalDateTime`, `LocalTime`, `ZonedDateTime`; `List`, `Map`, `Set`, `Optional`, `Queue`, `Deque`, `UUID`, `ArrayList`, `HashMap`; `ConcurrentHashMap`, `AtomicInteger`, `AtomicLong`, `Lock`, `ReentrantLock`, `ReadWriteLock`.
- **Why:** Readable in JSON, editable as plain text in the canvas, trivially passed to an LLM, and still analysable once parsed.
- **Rejected:** A nested object per type (verbose and awkward to edit inline), free text without a grammar (cannot find references).

### S5. Edges are declared relationships; fields are the implementation
- **Chose:** Edges record what the learner *declares* about how classes relate. Fields and method signatures record what the code *does*. Two consistency diagnostics connect them (section 5).
- **Why:** This mirrors how UML is taught and gives useful feedback: a composition arrow with no backing field is a design smell worth pointing out.
- **Rules:** Only `inheritance` and `implementation` affect generated code (`extends` and `implements`). Other edges are semantic only.

### S6. Edge direction conventions

| Kind | `from` | `to` | Cardinality |
|---|---|---|---|
| `inheritance` | subclass (or sub-interface) | superclass (or super-interface) | not allowed |
| `implementation` | class or enum | interface | not allowed |
| `composition` | whole | part | allowed |
| `aggregation` | whole | part | allowed |
| `association` | the class that holds the reference | referenced type | allowed |
| `dependency` | the class that uses | the used type | not allowed |

Cardinality grammar: `*`, `n`, `n..m` or `n..*`, for example `1`, `0..1`, `1..*`.

### S7. Enums and interfaces are restricted in v1
- Enums carry `constants` (at least one) and may also have fields, methods and constructors.
- Interfaces carry methods only. No fields, constructors or static state in v1. Interface methods are implicitly abstract.
- **Why:** This covers nearly every interview design and keeps code generation simple. Wider support can come with a schema bump.

### S8. Three validation layers
1. **Structure** (JSON Schema, `diagram.schema.json`): shapes, required keys, enums, patterns, enum constants, no cardinality on inheritance, implementation or dependency. A document that fails here cannot be loaded.
2. **Semantics** (`diagram-model` validator): produces *diagnostics* with a code, severity and node/member/edge ids. The store always holds a structurally valid document, and diagnostics are recomputed after every command.
3. **Analyzers** (`analyzers` library): design-quality findings such as SOLID heuristics and pattern detection. These assume there are no errors in the part of the diagram they inspect.
- **Why:** Learners spend most of their time in half-finished states. Rejecting them would make the editor unusable; diagnostics let them continue while seeing what is wrong.
- **Codegen rule:** A node with an error-level diagnostic is skipped, and the Java tab says why.

### S9. Versioning and migrations
- **Chose:** `schemaVersion` is an integer. Each bump ships a pure function `migrate(vN) → vN+1`. On load, run all needed migrations in order; the migrated document is written back only on the next explicit save.
- **A newer version than the app supports:** open read-only with a clear message. Never guess.
- **Why:** Saved attempts (local now, in Postgres later) must keep working across changes.

### S10. Canonical hash of the model
- **Chose:** `hashModel(d)` = SHA-256 over canonical JSON of `model` only: keys sorted, `nodes` and `edges` sorted by id, members sorted by id, normalised defaults filled in.
- **Uses:** Cache key for AI feedback, "has anything changed since last check?" detection, duplicate-attempt detection.
- **Note:** Member order is meaningful for display and code generation, and is preserved in the stored arrays. Only the hash ignores it.

---

## 4. Derived index (what consumers use)

Rules, codegen and matchers should not scan arrays by hand. `diagram-model` builds an index once per change:

```ts
interface ModelIndex {
  byId: Map<string, DiagramNode>;
  byName: Map<string, DiagramNode>;
  outgoing: Map<string, DiagramEdge[]>;
  incoming: Map<string, DiagramEdge[]>;
  superOf(id: string): DiagramNode | undefined;       // via inheritance
  implementersOf(id: string): DiagramNode[];          // via implementation
  subclassesOf(id: string): DiagramNode[];
  referencedTypes(id: string): Set<string>;           // from fields, params, returns
  fieldsReferencing(id: string, targetName: string): Field[];
}
```

---

## 5. Diagnostics (semantic layer)

| Code | Severity | Rule |
|---|---|---|
| `E_NAME_INVALID` | error | Name is not a legal Java identifier, or is a reserved word. |
| `E_NAME_DUPLICATE` | error | Two nodes share a name. |
| `E_EDGE_DANGLING` | error | An edge endpoint refers to a missing node. |
| `E_EDGE_ENDPOINTS` | error | Endpoint kinds break the table in S6 (for example `implementation` to a class). |
| `E_INHERIT_CYCLE` | error | Inheritance edges form a cycle. |
| `E_MULTIPLE_EXTENDS` | error | A class has more than one outgoing `inheritance` edge. |
| `E_TYPE_SYNTAX` | error | A type string does not match the grammar. |
| `E_MEMBER_DUPLICATE` | error | Duplicate field name, or two methods with the same name and parameter types. |
| `E_INTERFACE_MEMBER` | error | An interface has fields or constructors. |
| `E_ABSTRACT_MISPLACED` | error | An `abstract` method sits in a concrete class. |
| `W_TYPE_UNKNOWN` | warning | A type name is neither a node, a primitive, nor in the JDK registry. |
| `W_NAME_STYLE` | warning | Naming convention not followed. |
| `W_EDGE_NO_FIELD` | warning | An association, aggregation or composition edge from A to B, but no field in A references B. |
| `I_FIELD_NO_EDGE` | info | A field in A references node B, but no edge between A and B is drawn. |
| `I_NODE_ORPHAN` | info | A node has no edges. |

Each diagnostic carries `{ code, severity, message, nodeId?, memberId?, edgeId? }`, which feeds "Show on diagram".

---

## 6. Worked example: Parking Lot

`parking-lot.reference.json` is a complete, valid reference solution with 10 nodes and 11 edges. It validates against the schema, has no dangling edges or duplicate ids, resolves every type, and every association or composition edge has a backing field. It deliberately demonstrates:

- **Composition** with cardinality: `ParkingLot` `1` → `1..*` `ParkingFloor`, and `ParkingFloor` `1` → `*` `ParkingSpot`.
- **Strategy**: `PricingStrategy` interface in the `pricing` sub-package, with `HourlyPricingStrategy` and `SurgePricingStrategy` connected by `implementation` edges, and `ParkingLot` holding the strategy by association.
- **Strategy wrapping another strategy**: `SurgePricingStrategy` holds a `PricingStrategy` (a `wraps` association), which is how surge pricing composes on top of hourly pricing without duplication.
- **Enum**: `VehicleType` with constants, used in fields and map keys.
- **Concurrency hint**: `ParkingFloor.lock` as a `final ReentrantLock`, which the thread-safety analyzer looks for.
- **Dependencies**: `ParkingLot` depends on `Ticket` and `Receipt` (labelled), with no cardinality.

Package layout produced by codegen from this diagram (base package `com.blueprint.parkinglot`):

```
com/blueprint/parkinglot/ParkingLot.java
com/blueprint/parkinglot/ParkingFloor.java
com/blueprint/parkinglot/ParkingSpot.java
com/blueprint/parkinglot/Vehicle.java
com/blueprint/parkinglot/VehicleType.java
com/blueprint/parkinglot/Ticket.java
com/blueprint/parkinglot/Receipt.java
com/blueprint/parkinglot/pricing/PricingStrategy.java
com/blueprint/parkinglot/pricing/HourlyPricingStrategy.java
com/blueprint/parkinglot/pricing/SurgePricingStrategy.java
```

### How the earlier mockup's feedback maps onto the model

| Feedback shown | Model query |
|---|---|
| "Pricing strategy is not connected to Ticket" | A requirement matcher: `PricingStrategy` is referenced from a class that uses `Ticket` (via a method param or field). In the reference it is through `ParkingLot`. |
| "Spot allocation is not thread-safe" | A `ReentrantLock` field exists on the class that owns `getAvailableSpot`, but a lock-usage heuristic cannot see method bodies. v1 therefore checks for the field plus a naming and signature convention, and labels the result a heuristic. |
| "Single responsibility for Ticket" | `Ticket` has no methods that reference pricing types, and its fields are all data. |
| "Dynamic pricing strategy completeness" | An interface with at least two implementers, injected into another class. |

The thread-safety row is the honest limit of a diagram-only model: method bodies are not in the diagram. The rule can check for the lock's presence and for acquiring methods only if the learner annotates them. Treat that check as advisory, and consider a lightweight `notes` field on methods in a later version.

---

## 7. Commands that mutate the model

The `DiagramStore` exposes commands, each reversible:

`AddNode`, `RemoveNode`, `RenameNode`, `ChangeNodeKind`, `AddField`, `EditField`, `RemoveField`, `AddMethod`, `EditMethod`, `RemoveMethod`, `AddConstructor`, `EditConstructor`, `RemoveConstructor`, `AddConstant`, `RemoveConstant`, `Connect`, `Disconnect`, `EditEdge`, and `MoveNode` (layout only).

`RemoveNode` also removes its edges and layout entry in one undoable step.

---

## 8. Canvas adapter mapping (for the Foblex Flow spike)

| Model | Canvas |
|---|---|
| `model.nodes[i]` + `layout.nodes[id]` | One custom node component at that position, rendering name, stereotype, fields and methods |
| `model.edges[i]` | One connection, with an arrowhead style chosen from `kind` and labels from `label` and cardinalities |
| Drag end | `MoveNode` command (layout only) |
| Draw a connection | `Connect` command, with the kind taken from the active tool |
| Inline edit | `EditField` or `EditMethod` command |

The adapter never holds state of its own. If the canvas library is replaced, only this mapping changes.

---

## 9. Test plan for the schema library

- **Valid fixtures:** the Parking Lot reference, plus one minimal and one maximal document.
- **One failing fixture per diagnostic code**, asserting the exact code and ids returned.
- **Structure tests:** missing required keys, enum without constants, constants on a class, cardinality on an `implementation` edge, an unknown property (rejected).
- **Parser tests:** `parseType()` on nested generics, arrays, and invalid input.
- **Hash tests:** moving a node leaves the hash unchanged; renaming a node, adding a member, or reordering nodes in the array gives the expected result.
- **Migration tests:** a frozen v1 document must migrate cleanly through every future version (golden file kept in the repo).
- **Property test:** any sequence of commands, then undo for each, returns the original model hash.

---

## 10. Open items

1. **Method behaviour.** Diagram-only analysis cannot see inside methods. Decide whether v2 adds optional per-method notes (for example "acquires lock") or keeps thread-safety checks advisory.
2. **Generics on user types.** `Repository<T>` is not supported in v1. Add type parameters to nodes in v2 if problems need them.
3. **Static members and nested types.** Deliberately out of v1.
4. **Registry ownership.** The JDK registry is a data file; decide whether problems can extend it (for example `Clock` for time-based problems).

**Next step:** build `diagram-model` (types, normaliser, validator, index, hash, commands) with the test plan above, then run the Foblex Flow spike against `parking-lot.reference.json`.
