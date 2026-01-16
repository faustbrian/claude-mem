/**
 * SearchCore - Consolidated search strategies, orchestration, and filters
 */

import { SessionSearch } from '../../sqlite/SessionSearch.js';
import { SessionStore } from '../../sqlite/SessionStore.js';
import { ChromaSync } from '../../sync/ChromaSync.js';
import { ResultFormatter } from './ResultFormatter.js';
import { TimelineBuilder } from './TimelineBuilder.js';
import type { TimelineItem, TimelineData } from './TimelineBuilder.js';
import { SEARCH_CONSTANTS } from './types.js';
import type {
  StrategySearchOptions,
  StrategySearchResult,
  SearchResults,
  ObservationSearchResult,
  SessionSummarySearchResult,
  UserPromptSearchResult,
  ChromaMetadata,
  DateRange
} from './types.js';
import { logger } from '../../../utils/logger.js';

// ============================================================================
// FILTERS
// ============================================================================

export function parseDateRange(dateRange?: DateRange): {
  startEpoch?: number;
  endEpoch?: number;
} {
  if (!dateRange) {
    return {};
  }

  const result: { startEpoch?: number; endEpoch?: number } = {};

  if (dateRange.start) {
    result.startEpoch = typeof dateRange.start === 'number'
      ? dateRange.start
      : new Date(dateRange.start).getTime();
  }

  if (dateRange.end) {
    result.endEpoch = typeof dateRange.end === 'number'
      ? dateRange.end
      : new Date(dateRange.end).getTime();
  }

  return result;
}

/**
 * Check if an epoch timestamp is within a date range
 */
export function isWithinDateRange(
  epoch: number,
  dateRange?: DateRange
): boolean {
  if (!dateRange) {
    return true;
  }

  const { startEpoch, endEpoch } = parseDateRange(dateRange);

  if (startEpoch && epoch < startEpoch) {
    return false;
  }

  if (endEpoch && epoch > endEpoch) {
    return false;
  }

  return true;
}

/**
 * Check if an epoch timestamp is within the recency window
 */
export function isRecent(epoch: number): boolean {
  const cutoff = Date.now() - SEARCH_CONSTANTS.RECENCY_WINDOW_MS;
  return epoch > cutoff;
}

/**
 * Filter combined results by date range
 */
export function filterResultsByDate<T extends { epoch: number }>(
  results: T[],
  dateRange?: DateRange
): T[] {
  if (!dateRange) {
    return results;
  }

  return results.filter(result => isWithinDateRange(result.epoch, dateRange));
}

/**
 * Get date boundaries for common ranges
 */
export function getDateBoundaries(range: 'today' | 'week' | 'month' | '90days'): DateRange {
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  switch (range) {
    case 'today':
      return { start: startOfToday.getTime() };
    case 'week':
      return { start: now - 7 * 24 * 60 * 60 * 1000 };
    case 'month':
      return { start: now - 30 * 24 * 60 * 60 * 1000 };
    case '90days':
      return { start: now - SEARCH_CONSTANTS.RECENCY_WINDOW_MS };
  }
}

export function getCurrentProject(): string {
  return basename(process.cwd());
}

/**
 * Normalize project name for filtering
 */
export function normalizeProject(project?: string): string | undefined {
  if (!project) {
    return undefined;
  }

  // Remove leading/trailing whitespace
  const trimmed = project.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed;
}

/**
 * Check if a result matches the project filter
 */
export function matchesProject(
  resultProject: string,
  filterProject?: string
): boolean {
  if (!filterProject) {
    return true;
  }

  return resultProject === filterProject;
}

/**
 * Filter results by project
 */
export function filterResultsByProject<T extends { project: string }>(
  results: T[],
  project?: string
): T[] {
  if (!project) {
    return results;
  }

  return results.filter(result => matchesProject(result.project, project));
}

export const OBSERVATION_TYPES: ObservationType[] = [
  'decision',
  'bugfix',
  'feature',
  'refactor',
  'discovery',
  'change'
];

/**
 * Normalize type filter value(s)
 */
export function normalizeType(
  type?: string | string[]
): ObservationType[] | undefined {
  if (!type) {
    return undefined;
  }

  const types = Array.isArray(type) ? type : [type];
  const normalized = types
    .map(t => t.trim().toLowerCase())
    .filter(t => OBSERVATION_TYPES.includes(t as ObservationType)) as ObservationType[];

  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Check if a result matches the type filter
 */
export function matchesType(
  resultType: string,
  filterTypes?: ObservationType[]
): boolean {
  if (!filterTypes || filterTypes.length === 0) {
    return true;
  }

  return filterTypes.includes(resultType as ObservationType);
}

/**
 * Filter observations by type
 */
export function filterObservationsByType<T extends { type: string }>(
  observations: T[],
  types?: ObservationType[]
): T[] {
  if (!types || types.length === 0) {
    return observations;
  }

  return observations.filter(obs => matchesType(obs.type, types));
}

/**
 * Parse comma-separated type string
 */
export function parseTypeString(typeString: string): ObservationType[] {
  return typeString
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(t => OBSERVATION_TYPES.includes(t as ObservationType)) as ObservationType[];
}

// ============================================================================
// STRATEGY INTERFACES
// ============================================================================

export interface SearchStrategy {
  readonly name: string;
  canHandle(options: StrategySearchOptions): boolean;
  search(options: StrategySearchOptions): Promise<StrategySearchResult>;
}

export abstract class BaseSearchStrategy {
  protected emptyResult(strategy: string): StrategySearchResult {
    return {
      results: { observations: [], sessions: [], prompts: [] },
      usedChroma: strategy === 'chroma',
      fellBack: false,
      strategy
    };
  }
}

// ============================================================================
// STRATEGIES
// ============================================================================

export class SQLiteSearchStrategy extends BaseSearchStrategy implements SearchStrategy {
  readonly name = 'sqlite';

  constructor(private sessionSearch: SessionSearch) {
    super();
  }

  canHandle(options: StrategySearchOptions): boolean {
    // Can handle filter-only queries (no query text)
    // Also used as fallback when Chroma is unavailable
    return !options.query || options.strategyHint === 'sqlite';
  }

  async search(options: StrategySearchOptions): Promise<StrategySearchResult> {
    const {
      searchType = 'all',
      obsType,
      concepts,
      files,
      limit = SEARCH_CONSTANTS.DEFAULT_LIMIT,
      offset = 0,
      project,
      dateRange,
      orderBy = 'date_desc'
    } = options;

    const searchObservations = searchType === 'all' || searchType === 'observations';
    const searchSessions = searchType === 'all' || searchType === 'sessions';
    const searchPrompts = searchType === 'all' || searchType === 'prompts';

    let observations: ObservationSearchResult[] = [];
    let sessions: SessionSummarySearchResult[] = [];
    let prompts: UserPromptSearchResult[] = [];

    const baseOptions = { limit, offset, orderBy, project, dateRange };

    logger.debug('SEARCH', 'SQLiteSearchStrategy: Filter-only query', {
      searchType,
      hasDateRange: !!dateRange,
      hasProject: !!project
    });

    try {
      if (searchObservations) {
        const obsOptions = {
          ...baseOptions,
          type: obsType,
          concepts,
          files
        };
        observations = this.sessionSearch.searchObservations(undefined, obsOptions);
      }

      if (searchSessions) {
        sessions = this.sessionSearch.searchSessions(undefined, baseOptions);
      }

      if (searchPrompts) {
        prompts = this.sessionSearch.searchUserPrompts(undefined, baseOptions);
      }

      logger.debug('SEARCH', 'SQLiteSearchStrategy: Results', {
        observations: observations.length,
        sessions: sessions.length,
        prompts: prompts.length
      });

      return {
        results: { observations, sessions, prompts },
        usedChroma: false,
        fellBack: false,
        strategy: 'sqlite'
      };

    } catch (error) {
      logger.error('SEARCH', 'SQLiteSearchStrategy: Search failed', {}, error as Error);
      return this.emptyResult('sqlite');
    }
  }

  /**
   * Find observations by concept (used by findByConcept tool)
   */
  findByConcept(concept: string, options: StrategySearchOptions): ObservationSearchResult[] {
    const { limit = SEARCH_CONSTANTS.DEFAULT_LIMIT, project, dateRange, orderBy = 'date_desc' } = options;
    return this.sessionSearch.findByConcept(concept, { limit, project, dateRange, orderBy });
  }

  /**
   * Find observations by type (used by findByType tool)
   */
  findByType(type: string | string[], options: StrategySearchOptions): ObservationSearchResult[] {
    const { limit = SEARCH_CONSTANTS.DEFAULT_LIMIT, project, dateRange, orderBy = 'date_desc' } = options;
    return this.sessionSearch.findByType(type as any, { limit, project, dateRange, orderBy });
  }

  /**
   * Find observations and sessions by file path (used by findByFile tool)
   */
  findByFile(filePath: string, options: StrategySearchOptions): {
    observations: ObservationSearchResult[];
    sessions: SessionSummarySearchResult[];
  } {
    const { limit = SEARCH_CONSTANTS.DEFAULT_LIMIT, project, dateRange, orderBy = 'date_desc' } = options;
    return this.sessionSearch.findByFile(filePath, { limit, project, dateRange, orderBy });
  }
}

export class ChromaSearchStrategy extends BaseSearchStrategy implements SearchStrategy {
  readonly name = 'chroma';

  constructor(
    private chromaSync: ChromaSync,
    private sessionStore: SessionStore
  ) {
    super();
  }

  canHandle(options: StrategySearchOptions): boolean {
    // Can handle when query text is provided and Chroma is available
    return !!options.query && !!this.chromaSync;
  }

  async search(options: StrategySearchOptions): Promise<StrategySearchResult> {
    const {
      query,
      searchType = 'all',
      obsType,
      concepts,
      files,
      limit = SEARCH_CONSTANTS.DEFAULT_LIMIT,
      project,
      orderBy = 'date_desc'
    } = options;

    if (!query) {
      return this.emptyResult('chroma');
    }

    const searchObservations = searchType === 'all' || searchType === 'observations';
    const searchSessions = searchType === 'all' || searchType === 'sessions';
    const searchPrompts = searchType === 'all' || searchType === 'prompts';

    let observations: ObservationSearchResult[] = [];
    let sessions: SessionSummarySearchResult[] = [];
    let prompts: UserPromptSearchResult[] = [];

    try {
      // Build Chroma where filter for doc_type
      const whereFilter = this.buildWhereFilter(searchType);

      // Step 1: Chroma semantic search
      logger.debug('SEARCH', 'ChromaSearchStrategy: Querying Chroma', { query, searchType });
      const chromaResults = await this.chromaSync.queryChroma(
        query,
        SEARCH_CONSTANTS.CHROMA_BATCH_SIZE,
        whereFilter
      );

      logger.debug('SEARCH', 'ChromaSearchStrategy: Chroma returned matches', {
        matchCount: chromaResults.ids.length
      });

      if (chromaResults.ids.length === 0) {
        // No matches - this is the correct answer
        return {
          results: { observations: [], sessions: [], prompts: [] },
          usedChroma: true,
          fellBack: false,
          strategy: 'chroma'
        };
      }

      // Step 2: Filter by recency (90 days)
      const recentItems = this.filterByRecency(chromaResults);
      logger.debug('SEARCH', 'ChromaSearchStrategy: Filtered by recency', {
        count: recentItems.length
      });

      // Step 3: Categorize by document type
      const categorized = this.categorizeByDocType(recentItems, {
        searchObservations,
        searchSessions,
        searchPrompts
      });

      // Step 4: Hydrate from SQLite with additional filters
      if (categorized.obsIds.length > 0) {
        const obsOptions = { type: obsType, concepts, files, orderBy, limit, project };
        observations = this.sessionStore.getObservationsByIds(categorized.obsIds, obsOptions);
      }

      if (categorized.sessionIds.length > 0) {
        sessions = this.sessionStore.getSessionSummariesByIds(categorized.sessionIds, {
          orderBy,
          limit,
          project
        });
      }

      if (categorized.promptIds.length > 0) {
        prompts = this.sessionStore.getUserPromptsByIds(categorized.promptIds, {
          orderBy,
          limit,
          project
        });
      }

      logger.debug('SEARCH', 'ChromaSearchStrategy: Hydrated results', {
        observations: observations.length,
        sessions: sessions.length,
        prompts: prompts.length
      });

      return {
        results: { observations, sessions, prompts },
        usedChroma: true,
        fellBack: false,
        strategy: 'chroma'
      };

    } catch (error) {
      logger.error('SEARCH', 'ChromaSearchStrategy: Search failed', {}, error as Error);
      // Return empty result - caller may try fallback strategy
      return {
        results: { observations: [], sessions: [], prompts: [] },
        usedChroma: false,
        fellBack: false,
        strategy: 'chroma'
      };
    }
  }

  /**
   * Build Chroma where filter for document type
   */
  private buildWhereFilter(searchType: string): Record<string, any> | undefined {
    switch (searchType) {
      case 'observations':
        return { doc_type: 'observation' };
      case 'sessions':
        return { doc_type: 'session_summary' };
      case 'prompts':
        return { doc_type: 'user_prompt' };
      default:
        return undefined;
    }
  }

  /**
   * Filter results by recency (90-day window)
   */
  private filterByRecency(chromaResults: {
    ids: number[];
    metadatas: ChromaMetadata[];
  }): Array<{ id: number; meta: ChromaMetadata }> {
    const cutoff = Date.now() - SEARCH_CONSTANTS.RECENCY_WINDOW_MS;

    return chromaResults.metadatas
      .map((meta, idx) => ({
        id: chromaResults.ids[idx],
        meta
      }))
      .filter(item => item.meta && item.meta.created_at_epoch > cutoff);
  }

  /**
   * Categorize IDs by document type
   */
  private categorizeByDocType(
    items: Array<{ id: number; meta: ChromaMetadata }>,
    options: {
      searchObservations: boolean;
      searchSessions: boolean;
      searchPrompts: boolean;
    }
  ): { obsIds: number[]; sessionIds: number[]; promptIds: number[] } {
    const obsIds: number[] = [];
    const sessionIds: number[] = [];
    const promptIds: number[] = [];

    for (const item of items) {
      const docType = item.meta?.doc_type;
      if (docType === 'observation' && options.searchObservations) {
        obsIds.push(item.id);
      } else if (docType === 'session_summary' && options.searchSessions) {
        sessionIds.push(item.id);
      } else if (docType === 'user_prompt' && options.searchPrompts) {
        promptIds.push(item.id);
      }
    }

    return { obsIds, sessionIds, promptIds };
  }
}

export class HybridSearchStrategy extends BaseSearchStrategy implements SearchStrategy {
  readonly name = 'hybrid';

  constructor(
    private chromaSync: ChromaSync,
    private sessionStore: SessionStore,
    private sessionSearch: SessionSearch
  ) {
    super();
  }

  canHandle(options: StrategySearchOptions): boolean {
    // Can handle when we have metadata filters and Chroma is available
    return !!this.chromaSync && (
      !!options.concepts ||
      !!options.files ||
      (!!options.type && !!options.query) ||
      options.strategyHint === 'hybrid'
    );
  }

  async search(options: StrategySearchOptions): Promise<StrategySearchResult> {
    // This is the generic hybrid search - specific operations use dedicated methods
    const { query, limit = SEARCH_CONSTANTS.DEFAULT_LIMIT, project } = options;

    if (!query) {
      return this.emptyResult('hybrid');
    }

    // For generic hybrid search, use the standard Chroma path
    // More specific operations (findByConcept, etc.) have dedicated methods
    return this.emptyResult('hybrid');
  }

  /**
   * Find observations by concept with semantic ranking
   * Pattern: Metadata filter -> Chroma ranking -> Intersection -> Hydrate
   */
  async findByConcept(
    concept: string,
    options: StrategySearchOptions
  ): Promise<StrategySearchResult> {
    const { limit = SEARCH_CONSTANTS.DEFAULT_LIMIT, project, dateRange, orderBy } = options;
    const filterOptions = { limit, project, dateRange, orderBy };

    try {
      logger.debug('SEARCH', 'HybridSearchStrategy: findByConcept', { concept });

      // Step 1: SQLite metadata filter
      const metadataResults = this.sessionSearch.findByConcept(concept, filterOptions);
      logger.debug('SEARCH', 'HybridSearchStrategy: Found metadata matches', {
        count: metadataResults.length
      });

      if (metadataResults.length === 0) {
        return this.emptyResult('hybrid');
      }

      // Step 2: Chroma semantic ranking
      const ids = metadataResults.map(obs => obs.id);
      const chromaResults = await this.chromaSync.queryChroma(
        concept,
        Math.min(ids.length, SEARCH_CONSTANTS.CHROMA_BATCH_SIZE)
      );

      // Step 3: Intersect - keep only IDs from metadata, in Chroma rank order
      const rankedIds = this.intersectWithRanking(ids, chromaResults.ids);
      logger.debug('SEARCH', 'HybridSearchStrategy: Ranked by semantic relevance', {
        count: rankedIds.length
      });

      // Step 4: Hydrate in semantic rank order
      if (rankedIds.length > 0) {
        const observations = this.sessionStore.getObservationsByIds(rankedIds, { limit });
        // Restore semantic ranking order
        observations.sort((a, b) => rankedIds.indexOf(a.id) - rankedIds.indexOf(b.id));

        return {
          results: { observations, sessions: [], prompts: [] },
          usedChroma: true,
          fellBack: false,
          strategy: 'hybrid'
        };
      }

      return this.emptyResult('hybrid');

    } catch (error) {
      logger.error('SEARCH', 'HybridSearchStrategy: findByConcept failed', {}, error as Error);
      // Fall back to metadata-only results
      const results = this.sessionSearch.findByConcept(concept, filterOptions);
      return {
        results: { observations: results, sessions: [], prompts: [] },
        usedChroma: false,
        fellBack: true,
        strategy: 'hybrid'
      };
    }
  }

  /**
   * Find observations by type with semantic ranking
   */
  async findByType(
    type: string | string[],
    options: StrategySearchOptions
  ): Promise<StrategySearchResult> {
    const { limit = SEARCH_CONSTANTS.DEFAULT_LIMIT, project, dateRange, orderBy } = options;
    const filterOptions = { limit, project, dateRange, orderBy };
    const typeStr = Array.isArray(type) ? type.join(', ') : type;

    try {
      logger.debug('SEARCH', 'HybridSearchStrategy: findByType', { type: typeStr });

      // Step 1: SQLite metadata filter
      const metadataResults = this.sessionSearch.findByType(type as any, filterOptions);
      logger.debug('SEARCH', 'HybridSearchStrategy: Found metadata matches', {
        count: metadataResults.length
      });

      if (metadataResults.length === 0) {
        return this.emptyResult('hybrid');
      }

      // Step 2: Chroma semantic ranking
      const ids = metadataResults.map(obs => obs.id);
      const chromaResults = await this.chromaSync.queryChroma(
        typeStr,
        Math.min(ids.length, SEARCH_CONSTANTS.CHROMA_BATCH_SIZE)
      );

      // Step 3: Intersect with ranking
      const rankedIds = this.intersectWithRanking(ids, chromaResults.ids);
      logger.debug('SEARCH', 'HybridSearchStrategy: Ranked by semantic relevance', {
        count: rankedIds.length
      });

      // Step 4: Hydrate in rank order
      if (rankedIds.length > 0) {
        const observations = this.sessionStore.getObservationsByIds(rankedIds, { limit });
        observations.sort((a, b) => rankedIds.indexOf(a.id) - rankedIds.indexOf(b.id));

        return {
          results: { observations, sessions: [], prompts: [] },
          usedChroma: true,
          fellBack: false,
          strategy: 'hybrid'
        };
      }

      return this.emptyResult('hybrid');

    } catch (error) {
      logger.error('SEARCH', 'HybridSearchStrategy: findByType failed', {}, error as Error);
      const results = this.sessionSearch.findByType(type as any, filterOptions);
      return {
        results: { observations: results, sessions: [], prompts: [] },
        usedChroma: false,
        fellBack: true,
        strategy: 'hybrid'
      };
    }
  }

  /**
   * Find observations and sessions by file path with semantic ranking
   */
  async findByFile(
    filePath: string,
    options: StrategySearchOptions
  ): Promise<{
    observations: ObservationSearchResult[];
    sessions: SessionSummarySearchResult[];
    usedChroma: boolean;
  }> {
    const { limit = SEARCH_CONSTANTS.DEFAULT_LIMIT, project, dateRange, orderBy } = options;
    const filterOptions = { limit, project, dateRange, orderBy };

    try {
      logger.debug('SEARCH', 'HybridSearchStrategy: findByFile', { filePath });

      // Step 1: SQLite metadata filter
      const metadataResults = this.sessionSearch.findByFile(filePath, filterOptions);
      logger.debug('SEARCH', 'HybridSearchStrategy: Found file matches', {
        observations: metadataResults.observations.length,
        sessions: metadataResults.sessions.length
      });

      // Sessions don't need semantic ranking (already summarized)
      const sessions = metadataResults.sessions;

      if (metadataResults.observations.length === 0) {
        return { observations: [], sessions, usedChroma: false };
      }

      // Step 2: Chroma semantic ranking for observations
      const ids = metadataResults.observations.map(obs => obs.id);
      const chromaResults = await this.chromaSync.queryChroma(
        filePath,
        Math.min(ids.length, SEARCH_CONSTANTS.CHROMA_BATCH_SIZE)
      );

      // Step 3: Intersect with ranking
      const rankedIds = this.intersectWithRanking(ids, chromaResults.ids);
      logger.debug('SEARCH', 'HybridSearchStrategy: Ranked observations', {
        count: rankedIds.length
      });

      // Step 4: Hydrate in rank order
      if (rankedIds.length > 0) {
        const observations = this.sessionStore.getObservationsByIds(rankedIds, { limit });
        observations.sort((a, b) => rankedIds.indexOf(a.id) - rankedIds.indexOf(b.id));

        return { observations, sessions, usedChroma: true };
      }

      return { observations: [], sessions, usedChroma: false };

    } catch (error) {
      logger.error('SEARCH', 'HybridSearchStrategy: findByFile failed', {}, error as Error);
      const results = this.sessionSearch.findByFile(filePath, filterOptions);
      return {
        observations: results.observations,
        sessions: results.sessions,
        usedChroma: false
      };
    }
  }

  /**
   * Intersect metadata IDs with Chroma IDs, preserving Chroma's rank order
   */
  private intersectWithRanking(metadataIds: number[], chromaIds: number[]): number[] {
    const metadataSet = new Set(metadataIds);
    const rankedIds: number[] = [];

    for (const chromaId of chromaIds) {
      if (metadataSet.has(chromaId) && !rankedIds.includes(chromaId)) {
        rankedIds.push(chromaId);
      }
    }

    return rankedIds;
  }
}

// ============================================================================
// SEARCH ORCHESTRATOR
// ============================================================================

interface NormalizedParams extends StrategySearchOptions {
  concepts?: string[];
  files?: string[];
  obsType?: string[];
}
export class SearchOrchestrator {
  private chromaStrategy: ChromaSearchStrategy | null = null;
  private sqliteStrategy: SQLiteSearchStrategy;
  private hybridStrategy: HybridSearchStrategy | null = null;
  private resultFormatter: ResultFormatter;
  private timelineBuilder: TimelineBuilder;

  constructor(
    private sessionSearch: SessionSearch,
    private sessionStore: SessionStore,
    private chromaSync: ChromaSync | null
  ) {
    // Initialize strategies
    this.sqliteStrategy = new SQLiteSearchStrategy(sessionSearch);

    if (chromaSync) {
      this.chromaStrategy = new ChromaSearchStrategy(chromaSync, sessionStore);
      this.hybridStrategy = new HybridSearchStrategy(chromaSync, sessionStore, sessionSearch);
    }

    this.resultFormatter = new ResultFormatter();
    this.timelineBuilder = new TimelineBuilder();
  }

  /**
   * Main search entry point
   */
  async search(args: any): Promise<StrategySearchResult> {
    const options = this.normalizeParams(args);

    // Decision tree for strategy selection
    return await this.executeWithFallback(options);
  }

  /**
   * Execute search with fallback logic
   */
  private async executeWithFallback(
    options: NormalizedParams
  ): Promise<StrategySearchResult> {
    // PATH 1: FILTER-ONLY (no query text) - Use SQLite
    if (!options.query) {
      logger.debug('SEARCH', 'Orchestrator: Filter-only query, using SQLite', {});
      return await this.sqliteStrategy.search(options);
    }

    // PATH 2: CHROMA SEMANTIC SEARCH (query text + Chroma available)
    if (this.chromaStrategy) {
      logger.debug('SEARCH', 'Orchestrator: Using Chroma semantic search', {});
      const result = await this.chromaStrategy.search(options);

      // If Chroma succeeded (even with 0 results), return
      if (result.usedChroma) {
        return result;
      }

      // Chroma failed - fall back to SQLite for filter-only
      logger.debug('SEARCH', 'Orchestrator: Chroma failed, falling back to SQLite', {});
      const fallbackResult = await this.sqliteStrategy.search({
        ...options,
        query: undefined // Remove query for SQLite fallback
      });

      return {
        ...fallbackResult,
        fellBack: true
      };
    }

    // PATH 3: No Chroma available
    logger.debug('SEARCH', 'Orchestrator: Chroma not available', {});
    return {
      results: { observations: [], sessions: [], prompts: [] },
      usedChroma: false,
      fellBack: false,
      strategy: 'sqlite'
    };
  }

  /**
   * Find by concept with hybrid search
   */
  async findByConcept(concept: string, args: any): Promise<StrategySearchResult> {
    const options = this.normalizeParams(args);

    if (this.hybridStrategy) {
      return await this.hybridStrategy.findByConcept(concept, options);
    }

    // Fallback to SQLite
    const results = this.sqliteStrategy.findByConcept(concept, options);
    return {
      results: { observations: results, sessions: [], prompts: [] },
      usedChroma: false,
      fellBack: false,
      strategy: 'sqlite'
    };
  }

  /**
   * Find by type with hybrid search
   */
  async findByType(type: string | string[], args: any): Promise<StrategySearchResult> {
    const options = this.normalizeParams(args);

    if (this.hybridStrategy) {
      return await this.hybridStrategy.findByType(type, options);
    }

    // Fallback to SQLite
    const results = this.sqliteStrategy.findByType(type, options);
    return {
      results: { observations: results, sessions: [], prompts: [] },
      usedChroma: false,
      fellBack: false,
      strategy: 'sqlite'
    };
  }

  /**
   * Find by file with hybrid search
   */
  async findByFile(filePath: string, args: any): Promise<{
    observations: ObservationSearchResult[];
    sessions: any[];
    usedChroma: boolean;
  }> {
    const options = this.normalizeParams(args);

    if (this.hybridStrategy) {
      return await this.hybridStrategy.findByFile(filePath, options);
    }

    // Fallback to SQLite
    const results = this.sqliteStrategy.findByFile(filePath, options);
    return { ...results, usedChroma: false };
  }

  /**
   * Get timeline around anchor
   */
  getTimeline(
    timelineData: TimelineData,
    anchorId: number | string,
    anchorEpoch: number,
    depthBefore: number,
    depthAfter: number
  ): TimelineItem[] {
    const items = this.timelineBuilder.buildTimeline(timelineData);
    return this.timelineBuilder.filterByDepth(items, anchorId, anchorEpoch, depthBefore, depthAfter);
  }

  /**
   * Format timeline for display
   */
  formatTimeline(
    items: TimelineItem[],
    anchorId: number | string | null,
    options: {
      query?: string;
      depthBefore?: number;
      depthAfter?: number;
    } = {}
  ): string {
    return this.timelineBuilder.formatTimeline(items, anchorId, options);
  }

  /**
   * Format search results for display
   */
  formatSearchResults(
    results: SearchResults,
    query: string,
    chromaFailed: boolean = false
  ): string {
    return this.resultFormatter.formatSearchResults(results, query, chromaFailed);
  }

  /**
   * Get result formatter for direct access
   */
  getFormatter(): ResultFormatter {
    return this.resultFormatter;
  }

  /**
   * Get timeline builder for direct access
   */
  getTimelineBuilder(): TimelineBuilder {
    return this.timelineBuilder;
  }

  /**
   * Normalize query parameters from URL-friendly format
   */
  private normalizeParams(args: any): NormalizedParams {
    const normalized: any = { ...args };

    // Parse comma-separated concepts into array
    if (normalized.concepts && typeof normalized.concepts === 'string') {
      normalized.concepts = normalized.concepts.split(',').map((s: string) => s.trim()).filter(Boolean);
    }

    // Parse comma-separated files into array
    if (normalized.files && typeof normalized.files === 'string') {
      normalized.files = normalized.files.split(',').map((s: string) => s.trim()).filter(Boolean);
    }

    // Parse comma-separated obs_type into array
    if (normalized.obs_type && typeof normalized.obs_type === 'string') {
      normalized.obsType = normalized.obs_type.split(',').map((s: string) => s.trim()).filter(Boolean);
      delete normalized.obs_type;
    }

    // Parse comma-separated type (for filterSchema) into array
    if (normalized.type && typeof normalized.type === 'string' && normalized.type.includes(',')) {
      normalized.type = normalized.type.split(',').map((s: string) => s.trim()).filter(Boolean);
    }

    // Map 'type' param to 'searchType' for API consistency
    if (normalized.type && !normalized.searchType) {
      if (['observations', 'sessions', 'prompts'].includes(normalized.type)) {
        normalized.searchType = normalized.type;
        delete normalized.type;
      }
    }

    // Flatten dateStart/dateEnd into dateRange object
    if (normalized.dateStart || normalized.dateEnd) {
      normalized.dateRange = {
        start: normalized.dateStart,
        end: normalized.dateEnd
      };
      delete normalized.dateStart;
      delete normalized.dateEnd;
    }

    return normalized;
  }

  /**
   * Check if Chroma is available
   */
  isChromaAvailable(): boolean {
    return !!this.chromaSync;
  }
}
