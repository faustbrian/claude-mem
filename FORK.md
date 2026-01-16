# Claude-Mem Nuclear Refactor: Implementation Plan

## Executive Summary

**Goal:** Fork claude-mem and rebuild for Claude Code only, eliminating 85% of complexity.

**Scope:**
- Remove: Cursor, Gemini, OpenRouter, React UI, translations
- Migrate: Python Chroma MCP → TypeScript chromadb client
- Replace: Express → Bun.serve()
- Consolidate: 105 service files → ~20 files
- Target: 26k LOC → 5-8k LOC

**Timeline:** 1-2 weeks (nuclear refactor)

---

## Current vs. Target Architecture

### Current (26k LOC)
```
Hooks (ESM) → Express Server (port 37777)
                ↓
    SDKAgent + GeminiAgent + OpenRouterAgent
                ↓
    SQLite ← → Chroma (Python MCP subprocess)
                ↓
    React UI + Cursor Integration + Translations
```

### Target (5-8k LOC)
```
Hooks (ESM) → Bun.serve() Server (port 37777)
                ↓
          SDKAgent (Claude Code only)
                ↓
    SQLite ← → Chroma (TypeScript client)
                ↓
          (No UI, No IDE integrations)
```

---

## Implementation Phases

### Phase 0: Repository Setup (Day 1)

**Fork & Branch Strategy:**
```bash
# Fork thedotmack/claude-mem to your-username/claude-mem
# Create nuclear-refactor branch
git checkout -b nuclear-refactor
```

**Backup Data:**
```bash
# Backup existing installation
cp -r ~/.claude-mem ~/.claude-mem.backup
cp -r ~/.claude/plugins/marketplaces/thedotmack ~/claude-mem-backup
```

---

### Phase 1: Remove Cursor Integration (Day 2)

**Delete Files (38 files, 1,200 LOC):**
```bash
# Integration code
rm -rf src/services/integrations/
rm src/utils/cursor-utils.ts

# Cursor hooks
rm -rf cursor-hooks/

# Tests
rm tests/cursor-*.test.ts
```

**Modify Files:**

**1. src/services/worker-service.ts**
- Remove Lines 45-53: Cursor integration imports
- Remove Line 77: `export { updateCursorContextForProject }`
- Remove CLI command handling in `main()` (search for "cursor")

**2. src/services/worker/agents/ResponseProcessor.ts**
- Remove Line 16: `import { updateCursorContextForProject }`
- Remove call to `updateCursorContextForProject()` after summary processing

**3. package.json**
- Remove Lines 58-61: `cursor:install|uninstall|status|setup` scripts

**Verify:**
```bash
npm run build
npm test
# Should pass without Cursor tests
```

---

### Phase 2: Remove Gemini Agent (Day 2)

**Delete Files:**
```bash
rm src/services/worker/GeminiAgent.ts
rm tests/gemini_agent.test.ts
```

**Modify: src/services/worker-service.ts**
```typescript
// Remove Lines 60, 95-96
- import { GeminiAgent } from './worker/GeminiAgent.js';
- private geminiAgent: GeminiAgent;
- this.geminiAgent = new GeminiAgent(...);

// Remove from SessionRoutes constructor
- geminiAgent: this.geminiAgent,
```

**Modify: src/services/worker/http/routes/SessionRoutes.ts**
```typescript
// Remove Lines 60-67: Gemini selection logic
// Simplify getActiveAgent() to return only sdkAgent

private getActiveAgent(): SDKAgent {
  return this.sdkAgent;
}

// Remove getSelectedProvider() or hardcode 'claude'
private getSelectedProvider(): 'claude' {
  return 'claude';
}
```

**Modify: src/shared/SettingsDefaultsManager.ts**
```typescript
// Remove all CLAUDE_MEM_GEMINI_* settings
```

---

### Phase 3: Remove OpenRouter Agent (Day 2)

**Delete Files:**
```bash
rm src/services/worker/OpenRouterAgent.ts
```

**Follow same pattern as Gemini removal** (Phase 2)

---

### Phase 4: Remove Translations (Day 3)

**Delete Files (59 files, 620KB):**
```bash
# Mode files
cd plugin/modes/
rm code--*.json  # Keep code.json and code--chill.json

# i18n docs
rm -rf docs/i18n/

# Build scripts
rm -rf scripts/translate-readme/
```

**Modify: package.json**
```json
// Remove Lines 51-56: translate-readme scripts
```

**Update: README.md**
```markdown
# Remove translation badge links (Lines 16-43)
# Keep only English README
```

---

### Phase 5: Remove React UI (Day 3-4)

**Delete Files (34+ files, 3,083 LOC):**
```bash
# Source
rm -rf src/ui/viewer/
rm src/ui/viewer-template.html

# Build output
rm -rf plugin/ui/

# Build script
rm scripts/build-viewer.js
```

**Modify: scripts/build-hooks.js**
```typescript
// Remove Lines 78-90: Viewer build step
```

**Modify: package.json**
```json
"dependencies": {
  // Remove:
  // "react": "^18.3.1",
  // "react-dom": "^18.3.1"
},
"devDependencies": {
  // Remove:
  // "@types/react": "^18.3.5",
  // "@types/react-dom": "^18.3.0"
}
```

**Modify: src/services/worker/http/routes/ViewerRoutes.ts**

**Option A (Simple):** Replace with minimal HTML:
```typescript
app.get('/', (req, res) => {
  res.send(`
    <html>
      <body>
        <h1>Claude-Mem Worker Running</h1>
        <p>API: <a href="/api/sessions">/api/sessions</a></p>
      </body>
    </html>
  `);
});
```

**Option B (Remove):** Delete ViewerRoutes entirely, document API-only access

---

### Phase 6: Migrate Chroma to TypeScript (Day 5-6)

**Add Dependencies:**
```bash
npm install chromadb@^1.9.2
npm uninstall @modelcontextprotocol/sdk  # If only used for Chroma
```

**Create: src/services/infrastructure/ChromaServerManager.ts**
```typescript
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import os from 'os';

export class ChromaServerManager {
  private process: ChildProcess | null = null;
  private port: number;
  private host: string;
  private dataDir: string;

  constructor(dataDir: string, port: number = 8000) {
    this.dataDir = dataDir;
    this.port = port;
    this.host = '127.0.0.1';
  }

  async start(): Promise<void> {
    // Spawn: chroma run --path {dataDir} --port {port}
    this.process = spawn('chroma', [
      'run',
      '--path', this.dataDir,
      '--port', String(this.port),
      '--host', this.host
    ], {
      detached: true,
      stdio: 'ignore'
    });

    // Wait for health check
    await this.waitForHealth(10000);
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      // Wait 5s, then SIGKILL if needed
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`http://${this.host}:${this.port}/api/v1/heartbeat`);
      return response.ok;
    } catch {
      return false;
    }
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  private async waitForHealth(timeout: number): Promise<void> {
    // Poll healthCheck() until success or timeout
  }
}
```

**Modify: src/services/sync/ChromaSync.ts**

Replace MCP client with ChromaDB client:

```typescript
import { ChromaClient, Collection } from 'chromadb';
import { ChromaServerManager } from '../infrastructure/ChromaServerManager.js';

export class ChromaSync {
  private client: ChromaClient | null = null;
  private serverManager: ChromaServerManager;
  private collection: Collection | null = null;

  constructor(project: string) {
    this.project = project;
    this.collectionName = `cm__${project}`;
    this.VECTOR_DB_DIR = path.join(os.homedir(), '.claude-mem', 'vector-db');
    this.serverManager = new ChromaServerManager(this.VECTOR_DB_DIR);
  }

  private async ensureConnection(): Promise<void> {
    if (!this.serverManager.isRunning()) {
      await this.serverManager.start();
    }

    if (!this.client) {
      this.client = new ChromaClient({
        path: 'http://127.0.0.1:8000'
      });
    }
  }

  private async ensureCollection(): Promise<Collection> {
    await this.ensureConnection();

    if (!this.collection) {
      this.collection = await this.client!.getOrCreateCollection({
        name: this.collectionName,
        metadata: { 'hnsw:space': 'cosine' }
      });
    }

    return this.collection;
  }

  async addDocuments(documents: ChromaDocument[]): Promise<void> {
    const collection = await this.ensureCollection();

    await collection.add({
      ids: documents.map(d => d.id),
      documents: documents.map(d => d.document),
      metadatas: documents.map(d => d.metadata)
    });
  }

  async queryChroma(queryText: string, nResults: number = 50): Promise<QueryResult> {
    const collection = await this.ensureCollection();

    const results = await collection.query({
      queryTexts: [queryText],
      nResults,
      include: ['documents', 'metadatas', 'distances']
    });

    return this.formatResults(results);
  }

  async close(): Promise<void> {
    await this.serverManager.stop();
    this.client = null;
    this.collection = null;
  }
}
```

**Update: src/shared/SettingsDefaultsManager.ts**
```typescript
// Add:
CLAUDE_MEM_CHROMA_PORT: '8000',
CLAUDE_MEM_CHROMA_HOST: '127.0.0.1',

// Remove:
CLAUDE_MEM_PYTHON_VERSION: ...
```

**Data Migration:** None needed! Existing `~/.claude-mem/vector-db/` works as-is.

---

### Phase 7: Replace Express with Bun.serve() (Day 7-9)

**⚠️ HIGH RISK - Consider deferring to v10.0.0**

**Remove Dependencies:**
```json
// Remove from package.json:
"express": "^4.18.2",
"@types/express": "^4.17.21"
```

**Rewrite: src/services/worker-service.ts**

Complete server rewrite:

```typescript
import { serve, Server } from 'bun';
import { Database } from 'bun:sqlite';

class WorkerService {
  private server: Server;
  private db: Database;

  async start() {
    this.server = serve({
      port: 37777,
      fetch: this.handleRequest.bind(this),
    });
  }

  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Route handling
    if (url.pathname === '/api/context/inject') {
      return this.handleContextInject(req);
    }

    if (url.pathname === '/api/sessions/observations') {
      return this.handleObservation(req);
    }

    // ... other routes

    return new Response('Not Found', { status: 404 });
  }

  private async handleContextInject(req: Request): Promise<Response> {
    const project = new URL(req.url).searchParams.get('project');
    const context = await this.buildContext(project);
    return Response.json({ context });
  }

  private async handleObservation(req: Request): Promise<Response> {
    const data = await req.json();
    await this.saveObservation(data);
    return Response.json({ success: true });
  }
}
```

**Convert All Route Handlers:**

Pattern for each route:
```typescript
// Before (Express):
router.post('/observations', async (req, res) => {
  const data = req.body;
  await save(data);
  res.json({ success: true });
});

// After (Bun):
private async handleObservations(req: Request): Promise<Response> {
  const data = await req.json();
  await save(data);
  return Response.json({ success: true });
}
```

**SSE Rewrite (most complex):**
```typescript
// Replace Express res.write() with ReadableStream
private handleSSE(req: Request): Response {
  const stream = new ReadableStream({
    start(controller) {
      // Broadcast logic using controller.enqueue()
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}
```

---

### Phase 8: Remove Deprecated Code (Day 10)

**FTS5 Removal:**
```typescript
// src/services/sqlite/SessionSearch.ts
// Remove Lines 32-145: ensureFTSTables()
```

**context-generator.ts:**
```bash
rm src/services/context-generator.ts
# Update imports in worker-service.ts
```

**JSONL Legacy:**
```bash
# Search and remove:
rg "\.jsonl|JSONL" src --files-with-matches
# Remove legacy format handling
```

---

### Phase 9: Consolidate Service Layer (Day 11-14)

**Search Module (12 → 4 files):**
```bash
# Merge into src/services/worker/Search.ts:
cat search/SearchOrchestrator.ts \
    search/strategies/*.ts \
    search/filters/*.ts > Search.ts

# Keep separate:
search/types.ts
search/ResultFormatter.ts
search/index.ts
```

**Context Module (10 → 4 files):**
```bash
# Merge into src/services/context/Builder.ts:
cat ContextBuilder.ts \
    ObservationCompiler.ts \
    TokenCalculator.ts > Builder.ts

# Merge into src/services/context/Formatters.ts:
cat formatters/*.ts \
    sections/*.ts > Formatters.ts
```

**SQLite Module (25 → 7 files):**
```typescript
// Consolidate subdirectories into parent files:
// observations/*.ts → merge into SessionStore.ts
// prompts/*.ts → merge into SessionStore.ts
// summaries/*.ts → merge into SessionStore.ts
// sessions/*.ts → merge into SessionStore.ts
// timeline/*.ts → merge into SessionSearch.ts
```

**Update all imports** across codebase after consolidation.

---

## Build & Test

**Build Pipeline:**
```bash
npm run build  # Single esbuild script
# Outputs:
#   plugin/scripts/worker.js (Bun.serve server)
#   plugin/scripts/context-hook.js
#   plugin/scripts/new-hook.js
#   plugin/scripts/save-hook.js
#   plugin/scripts/summary-hook.js
```

**Test Strategy:**
```bash
# After each phase:
npm test

# Integration testing:
# 1. Install forked plugin
# 2. Test context injection on SessionStart
# 3. Capture observations on PostToolUse
# 4. Generate summary on SessionEnd
# 5. Search via MCP server
```

---

## Final Structure

```
fork/
├── src/
│   ├── hooks/                 # 4 files (context, new, save, summary)
│   ├── services/
│   │   ├── worker-service.ts  # Bun.serve main (~800 LOC)
│   │   ├── context/          # 4 files (Builder, Formatters, types, index)
│   │   ├── sqlite/           # 7 files (SessionStore, SessionSearch, etc.)
│   │   ├── sync/             # 1 file (ChromaSync.ts with TS client)
│   │   ├── worker/           # 6 files (SDKAgent, Search, etc.)
│   │   └── infrastructure/   # 3 files (ChromaServerManager, etc.)
│   ├── sdk/                  # 3 files (agent, parser, prompts)
│   ├── servers/              # 1 file (mcp-server.ts)
│   └── shared/               # 5 files (logger, paths, settings, etc.)
├── plugin/
│   ├── hooks/hooks.json
│   └── scripts/*.js           # 5 compiled bundles
├── tests/                     # ~20 test files (remove cursor/gemini/etc.)
├── scripts/
│   └── build-hooks.js         # Single build script
└── package.json               # 4-7 dependencies

Total: ~70 files, ~5-8k LOC
```

---

## Success Criteria

**Must Have:**
- [ ] All 4 hooks execute successfully
- [ ] Context injection works on SessionStart
- [ ] Observations stored on PostToolUse
- [ ] Summaries generated on SessionEnd
- [ ] Semantic search returns results
- [ ] No Python dependencies
- [ ] Build completes in <5s
- [ ] Worker starts in <500ms

**Metrics:**
- [ ] LOC: 26k → 5-8k (70%+ reduction)
- [ ] Files: 237 → ~70 (70%+ reduction)
- [ ] Dependencies: 11 → 4-7 (55%+ reduction)
- [ ] Startup time: <500ms
- [ ] Memory: <80MB (vs current ~150MB)

---

## Risks & Mitigation

**High Risk:**
- **Express → Bun.serve:** SSE complexity, error handling
  - *Mitigation:* Defer to v10.0.0, keep Express for initial fork

- **Service consolidation:** Breaking imports across codebase
  - *Mitigation:* Use IDE refactoring tools, comprehensive testing

**Medium Risk:**
- **Chroma TypeScript client:** Different API surface
  - *Mitigation:* Keep data format compatible, test backfill

**Low Risk:**
- **Removing Cursor/Gemini/OpenRouter:** Clean abstractions
  - *Mitigation:* Sequential removal, test after each

---

## Critical Files

### Must Read Before Starting:
1. `/Users/brian/.claude/plugins/marketplaces/thedotmack/src/services/worker-service.ts`
2. `/Users/brian/.claude/plugins/marketplaces/thedotmack/src/services/sync/ChromaSync.ts`
3. `/Users/brian/.claude/plugins/marketplaces/thedotmack/src/services/worker/SDKAgent.ts`
4. `/Users/brian/.claude/plugins/marketplaces/thedotmack/src/services/sqlite/SessionStore.ts`
5. `/Users/brian/.claude/plugins/marketplaces/thedotmack/src/hooks/context-hook.ts`

### Reference During Implementation:
- Hook patterns: `src/hooks/*.ts`
- Route handlers: `src/services/worker/http/routes/*.ts`
- Database schema: `src/services/sqlite/migrations.ts`
- Search logic: `src/services/worker/SearchManager.ts`

---

## Next Steps

1. Fork repository
2. Create `nuclear-refactor` branch
3. Backup existing data
4. Execute phases 1-6 sequentially
5. Defer phase 7 (Express) if too risky
6. Execute phases 8-9 last
7. Comprehensive testing
8. Document breaking changes
9. Create v9.0.0-alpha release
