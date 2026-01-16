/**
 * Context Module - Public API
 */

export {
  calculateTokenEconomics,
  calculateObservationTokens,
  queryObservations,
  querySummaries,
  buildTimeline,
  getPriorSessionMessages,
  queryObservationsMulti,
  querySummariesMulti,
  extractPriorMessages,
  prepareSummariesForTimeline,
  getFullObservationIds,
  getWorkEmoji,
  formatObservationTokenDisplay,
  shouldShowContextEconomics,
} from './ContextCore.js';
export * from './Renderers.js';
export type { ContextInput, ContextConfig, ContextSection, ObservationForDisplay, TokenEconomics, PriorMessages } from './types.js';
