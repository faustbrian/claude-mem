/**
 * Search Module - Named exports for search functionality
 *
 * This is the public API for the search module.
 */

// Main orchestrator, strategies, and filters (consolidated)
export {
  SearchOrchestrator,
  BaseSearchStrategy,
  ChromaSearchStrategy,
  SQLiteSearchStrategy,
  HybridSearchStrategy,
  DateFilter,
  ProjectFilter,
  TypeFilter
} from './SearchCore.js';
export type { SearchStrategy } from './SearchCore.js';

// Formatters
export { ResultFormatter } from './ResultFormatter.js';
export { TimelineBuilder } from './TimelineBuilder.js';
export type { TimelineItem, TimelineData } from './TimelineBuilder.js';

// Types
export * from './types.js';
