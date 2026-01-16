# Phase 9: Service Layer Consolidation - Breakdown

## Current State Analysis

### File Counts
- **Search Module**: 12 files → Target: 4 files
- **Context Module**: 10 files → Target: 4 files
- **SQLite Module**: 25 files → Target: 7 files
- **Total**: 47 files → 15 files (68% reduction)

### Dependency Analysis

**Search Module** (Low coupling)
- Used by: SearchManager.ts, worker-service routes
- Dependencies: SessionStore, SessionSearch, ChromaSync
- Internal structure:
  - `SearchOrchestrator.ts` - coordinates strategies
  - `strategies/` (5 files) - search implementations
  - `filters/` (3 files) - date, project, type filters
  - `TimelineBuilder.ts`, `ResultFormatter.ts` - output formatting
  - `types.ts`, `index.ts` - exports

**Context Module** (Low coupling)
- Used by: hooks (context-hook), worker routes
- Dependencies: SessionStore only
- Internal structure:
  - `ContextBuilder.ts` - main orchestrator
  - `ObservationCompiler.ts`, `TokenCalculator.ts`, `ContextConfigLoader.ts` - core logic
  - `formatters/` (2 files) - color, markdown
  - `sections/` (4 files) - header, footer, summary, timeline renderers
  - `types.ts`, `index.ts` - exports

**SQLite Module** (High coupling - CAUTION)
- Used by: 15+ files across worker services
- Internal structure:
  - Core: `Database.ts`, `SessionStore.ts`, `SessionSearch.ts`
  - Wrappers (re-exports): `Observations.ts`, `Prompts.ts`, `Sessions.ts`, `Summaries.ts`, `Timeline.ts`
  - Implementation subdirs: `observations/`, `prompts/`, `sessions/`, `summaries/`, `timeline/`
  - Each subdir has: `types.ts`, `store.ts`, `get.ts`, `recent.ts`, etc.

---

## Consolidation Strategy

### Phase 9a: Search Module (SAFE - 1 commit)
**Risk**: Low - only used by SearchManager
**Files to merge**: 12 → 4

1. **Create** `src/services/worker/search/SearchCore.ts`
   - Merge: `SearchOrchestrator.ts`, all `strategies/*.ts`, all `filters/*.ts`
   - Keep class structure, just consolidate into one file
   - ~500 LOC total

2. **Keep** `ResultFormatter.ts`, `TimelineBuilder.ts`, `types.ts`, `index.ts`

3. **Update imports** in `SearchManager.ts`

**Benefit**: Simpler search module, easier to understand strategy pattern

---

### Phase 9b: Context Module (SAFE - 1 commit)
**Risk**: Low - only used by hooks and context routes
**Files to merge**: 10 → 4

1. **Create** `src/services/context/ContextCore.ts`
   - Merge: `ContextBuilder.ts`, `ObservationCompiler.ts`, `TokenCalculator.ts`, `ContextConfigLoader.ts`
   - ~600 LOC total

2. **Create** `src/services/context/Renderers.ts`
   - Merge: all `formatters/*.ts`, all `sections/*.ts`
   - ~400 LOC total

3. **Keep** `types.ts`, `index.ts`

4. **Update imports** in hooks and routes

**Benefit**: Flatter structure, easier to navigate

---

### Phase 9c: SQLite Module - Careful Approach (3 commits)
**Risk**: HIGH - used by 15+ files
**Strategy**: Merge subdirs into parent wrappers, maintain public API

#### Step 1: Merge observations/ → Observations.ts (1 commit)

Current:
```
Observations.ts (12 lines - re-exports)
observations/
  ├── types.ts
  ├── store.ts
  ├── get.ts
  ├── recent.ts
  └── files.ts
```

Target:
```
Observations.ts (~300 LOC)
  - Contains all observation operations
  - Same export signature
```

**Action**:
1. Read all 5 files in `observations/`
2. Merge into `Observations.ts`
3. Delete `observations/` directory
4. No import changes needed (exports stay same)

#### Step 2: Merge prompts/ → Prompts.ts (1 commit)

Same pattern as observations:
- Merge 3 files (~150 LOC)
- Delete `prompts/` directory

#### Step 3: Merge sessions/, summaries/, timeline/ (1 commit)

- `Sessions.ts` ← `sessions/` (3 files, ~200 LOC)
- `Summaries.ts` ← `summaries/` (4 files, ~250 LOC)
- `Timeline.ts` ← `timeline/` (2 files, ~150 LOC)

---

## Alternative: Defer SQLite Consolidation

**Rationale**: SQLite module works fine, high risk, marginal benefit

**Modified Phase 9**:
- 9a: Search Module consolidation (safe)
- 9b: Context Module consolidation (safe)
- ~~9c: SQLite consolidation (deferred to v10)~~

**Outcome**: 22 → 11 files (50% reduction), avoid high-risk refactor

---

## Recommended Approach

### Option 1: Full Consolidation (3 separate commits)
1. Search module (12→4 files)
2. Context module (10→4 files)
3. SQLite module (25→7 files)

**Pros**: Achieves FORK.md targets
**Cons**: SQLite refactor risky, time-consuming

### Option 2: Safe Consolidation (2 commits, defer SQLite)
1. Search module (12→4 files)
2. Context module (10→4 files)

**Pros**: Low risk, quick wins, 50% file reduction
**Cons**: Doesn't fully achieve targets

---

## Testing Strategy

After each consolidation:
1. `npm run build` - verify compilation
2. `npm test` - run test suite
3. Manual test: start worker, inject context, save observation, search
4. Check imports across codebase

---

## Recommendation

**Start with Option 2** (Safe Consolidation):
- Do search + context modules first (low risk)
- Get 50% file reduction
- Evaluate if SQLite consolidation worth the risk
- SQLite subdirectories are well-organized, arguably clearer than mega-files
