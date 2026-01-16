/**
 * Search Module - Named exports for search functionality
 *
 * This is the public API for the search module.
 */

// Main orchestrator and strategies (consolidated)
export {
  SearchOrchestrator,
  BaseSearchStrategy,
  ChromaSearchStrategy,
  SQLiteSearchStrategy,
  HybridSearchStrategy
} from './SearchCore.js';
export type { SearchStrategy } from './SearchCore.js';

// Filter utilities
export {
  parseDateRange,
  isWithinDateRange,
  isRecent,
  filterResultsByDate,
  getDateBoundaries,
  getCurrentProject,
  normalizeProject,
  matchesProject,
  filterResultsByProject,
  normalizeType,
  matchesType,
  filterObservationsByType,
  parseTypeString
} from './SearchCore.js';

// Formatters
export { ResultFormatter } from './ResultFormatter.js';
export { TimelineBuilder } from './TimelineBuilder.js';
export type { TimelineItem, TimelineData } from './TimelineBuilder.js';

// Types
export * from './types.js';
