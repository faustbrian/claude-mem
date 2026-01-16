/**
 * Renderers - Consolidated formatters and section renderers
 */

import type {
  ContextSection,
  ObservationForDisplay,
  SessionSummary
} from './types.js';
import { colors } from './types.js';
import { ModeManager } from '../domain/ModeManager.js';
import { formatObservationTokenDisplay } from './ContextCore.js';

/**
 * Format current date/time for header display
 */
function formatHeaderDateTime(): string {
  const now = new Date();
  const date = now.toLocaleDateString('en-CA'); // YYYY-MM-DD format
  const time = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).toLowerCase().replace(' ', '');
  const tz = now.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop();
  return `${date} ${time} ${tz}`;
}

// ============================================================================
// FORMATTERS
// ============================================================================

export function renderColorHeader(project: string): string[] {
  return [
    '',
    `${colors.bright}${colors.cyan}[${project}] recent context, ${formatHeaderDateTime()}${colors.reset}`,
    `${colors.gray}${'─'.repeat(60)}${colors.reset}`,
    ''
  ];
}

/**
 * Render colored legend
 */
export function renderColorLegend(): string[] {
  const mode = ModeManager.getInstance().getActiveMode();
  const typeLegendItems = mode.observation_types.map(t => `${t.emoji} ${t.id}`).join(' | ');

  return [
    `${colors.dim}Legend: session-request | ${typeLegendItems}${colors.reset}`,
    ''
  ];
}

/**
 * Render colored column key
 */
export function renderColorColumnKey(): string[] {
  return [
    `${colors.bright}Column Key${colors.reset}`,
    `${colors.dim}  Read: Tokens to read this observation (cost to learn it now)${colors.reset}`,
    `${colors.dim}  Work: Tokens spent on work that produced this record ( research, building, deciding)${colors.reset}`,
    ''
  ];
}

/**
 * Render colored context index instructions
 */
export function renderColorContextIndex(): string[] {
  return [
    `${colors.dim}Context Index: This semantic index (titles, types, files, tokens) is usually sufficient to understand past work.${colors.reset}`,
    '',
    `${colors.dim}When you need implementation details, rationale, or debugging context:${colors.reset}`,
    `${colors.dim}  - Use MCP tools (search, get_observations) to fetch full observations on-demand${colors.reset}`,
    `${colors.dim}  - Critical types ( bugfix, decision) often need detailed fetching${colors.reset}`,
    `${colors.dim}  - Trust this index over re-reading code for past decisions and learnings${colors.reset}`,
    ''
  ];
}

/**
 * Render colored context economics
 */
export function renderColorContextEconomics(
  economics: TokenEconomics,
  config: ContextConfig
): string[] {
  const output: string[] = [];

  output.push(`${colors.bright}${colors.cyan}Context Economics${colors.reset}`);
  output.push(`${colors.dim}  Loading: ${economics.totalObservations} observations (${economics.totalReadTokens.toLocaleString()} tokens to read)${colors.reset}`);
  output.push(`${colors.dim}  Work investment: ${economics.totalDiscoveryTokens.toLocaleString()} tokens spent on research, building, and decisions${colors.reset}`);

  if (economics.totalDiscoveryTokens > 0 && (config.showSavingsAmount || config.showSavingsPercent)) {
    let savingsLine = '  Your savings: ';
    if (config.showSavingsAmount && config.showSavingsPercent) {
      savingsLine += `${economics.savings.toLocaleString()} tokens (${economics.savingsPercent}% reduction from reuse)`;
    } else if (config.showSavingsAmount) {
      savingsLine += `${economics.savings.toLocaleString()} tokens`;
    } else {
      savingsLine += `${economics.savingsPercent}% reduction from reuse`;
    }
    output.push(`${colors.green}${savingsLine}${colors.reset}`);
  }
  output.push('');

  return output;
}

/**
 * Render colored day header
 */
export function renderColorDayHeader(day: string): string[] {
  return [
    `${colors.bright}${colors.cyan}${day}${colors.reset}`,
    ''
  ];
}

/**
 * Render colored file header
 */
export function renderColorFileHeader(file: string): string[] {
  return [
    `${colors.dim}${file}${colors.reset}`
  ];
}

/**
 * Render colored table row for observation
 */
export function renderColorTableRow(
  obs: Observation,
  time: string,
  showTime: boolean,
  config: ContextConfig
): string {
  const title = obs.title || 'Untitled';
  const icon = ModeManager.getInstance().getTypeIcon(obs.type);
  const { readTokens, discoveryTokens, workEmoji } = formatObservationTokenDisplay(obs, config);

  const timePart = showTime ? `${colors.dim}${time}${colors.reset}` : ' '.repeat(time.length);
  const readPart = (config.showReadTokens && readTokens > 0) ? `${colors.dim}(~${readTokens}t)${colors.reset}` : '';
  const discoveryPart = (config.showWorkTokens && discoveryTokens > 0) ? `${colors.dim}(${workEmoji} ${discoveryTokens.toLocaleString()}t)${colors.reset}` : '';

  return `  ${colors.dim}#${obs.id}${colors.reset}  ${timePart}  ${icon}  ${title} ${readPart} ${discoveryPart}`;
}

/**
 * Render colored full observation
 */
export function renderColorFullObservation(
  obs: Observation,
  time: string,
  showTime: boolean,
  detailField: string | null,
  config: ContextConfig
): string[] {
  const output: string[] = [];
  const title = obs.title || 'Untitled';
  const icon = ModeManager.getInstance().getTypeIcon(obs.type);
  const { readTokens, discoveryTokens, workEmoji } = formatObservationTokenDisplay(obs, config);

  const timePart = showTime ? `${colors.dim}${time}${colors.reset}` : ' '.repeat(time.length);
  const readPart = (config.showReadTokens && readTokens > 0) ? `${colors.dim}(~${readTokens}t)${colors.reset}` : '';
  const discoveryPart = (config.showWorkTokens && discoveryTokens > 0) ? `${colors.dim}(${workEmoji} ${discoveryTokens.toLocaleString()}t)${colors.reset}` : '';

  output.push(`  ${colors.dim}#${obs.id}${colors.reset}  ${timePart}  ${icon}  ${colors.bright}${title}${colors.reset}`);
  if (detailField) {
    output.push(`    ${colors.dim}${detailField}${colors.reset}`);
  }
  if (readPart || discoveryPart) {
    output.push(`    ${readPart} ${discoveryPart}`);
  }
  output.push('');

  return output;
}

/**
 * Render colored summary item in timeline
 */
export function renderColorSummaryItem(
  summary: { id: number; request: string | null },
  formattedTime: string
): string[] {
  const summaryTitle = `${summary.request || 'Session started'} (${formattedTime})`;
  return [
    `${colors.yellow}#S${summary.id}${colors.reset} ${summaryTitle}`,
    ''
  ];
}

/**
 * Render colored summary field
 */
export function renderColorSummaryField(label: string, value: string | null, color: string): string[] {
  if (!value) return [];
  return [`${color}${label}:${colors.reset} ${value}`, ''];
}

/**
 * Render colored previously section
 */
export function renderColorPreviouslySection(priorMessages: PriorMessages): string[] {
  if (!priorMessages.assistantMessage) return [];

  return [
    '',
    '---',
    '',
    `${colors.bright}${colors.magenta}Previously${colors.reset}`,
    '',
    `${colors.dim}A: ${priorMessages.assistantMessage}${colors.reset}`,
    ''
  ];
}

/**
 * Render colored footer
 */
export function renderColorFooter(totalDiscoveryTokens: number, totalReadTokens: number): string[] {
  const workTokensK = Math.round(totalDiscoveryTokens / 1000);
  return [
    '',
    `${colors.dim}Access ${workTokensK}k tokens of past research & decisions for just ${totalReadTokens.toLocaleString()}t. Use MCP search tools to access memories by ID.${colors.reset}`
  ];
}

/**
 * Render colored empty state
 */
export function renderColorEmptyState(project: string): string {
  return `\n${colors.bright}${colors.cyan}[${project}] recent context, ${formatHeaderDateTime()}${colors.reset}\n${colors.gray}${'─'.repeat(60)}${colors.reset}\n\n${colors.dim}No previous sessions found for this project yet.${colors.reset}\n`;
}

export function renderMarkdownHeader(project: string): string[] {
  return [
    `# [${project}] recent context, ${formatHeaderDateTime()}`,
    ''
  ];
}

/**
 * Render markdown legend
 */
export function renderMarkdownLegend(): string[] {
  const mode = ModeManager.getInstance().getActiveMode();
  const typeLegendItems = mode.observation_types.map(t => `${t.emoji} ${t.id}`).join(' | ');

  return [
    `**Legend:** session-request | ${typeLegendItems}`,
    ''
  ];
}

/**
 * Render markdown column key
 */
export function renderMarkdownColumnKey(): string[] {
  return [
    `**Column Key**:`,
    `- **Read**: Tokens to read this observation (cost to learn it now)`,
    `- **Work**: Tokens spent on work that produced this record ( research, building, deciding)`,
    ''
  ];
}

/**
 * Render markdown context index instructions
 */
export function renderMarkdownContextIndex(): string[] {
  return [
    `**Context Index:** This semantic index (titles, types, files, tokens) is usually sufficient to understand past work.`,
    '',
    `When you need implementation details, rationale, or debugging context:`,
    `- Use MCP tools (search, get_observations) to fetch full observations on-demand`,
    `- Critical types ( bugfix, decision) often need detailed fetching`,
    `- Trust this index over re-reading code for past decisions and learnings`,
    ''
  ];
}

/**
 * Render markdown context economics
 */
export function renderMarkdownContextEconomics(
  economics: TokenEconomics,
  config: ContextConfig
): string[] {
  const output: string[] = [];

  output.push(`**Context Economics**:`);
  output.push(`- Loading: ${economics.totalObservations} observations (${economics.totalReadTokens.toLocaleString()} tokens to read)`);
  output.push(`- Work investment: ${economics.totalDiscoveryTokens.toLocaleString()} tokens spent on research, building, and decisions`);

  if (economics.totalDiscoveryTokens > 0 && (config.showSavingsAmount || config.showSavingsPercent)) {
    let savingsLine = '- Your savings: ';
    if (config.showSavingsAmount && config.showSavingsPercent) {
      savingsLine += `${economics.savings.toLocaleString()} tokens (${economics.savingsPercent}% reduction from reuse)`;
    } else if (config.showSavingsAmount) {
      savingsLine += `${economics.savings.toLocaleString()} tokens`;
    } else {
      savingsLine += `${economics.savingsPercent}% reduction from reuse`;
    }
    output.push(savingsLine);
  }
  output.push('');

  return output;
}

/**
 * Render markdown day header
 */
export function renderMarkdownDayHeader(day: string): string[] {
  return [
    `### ${day}`,
    ''
  ];
}

/**
 * Render markdown file header with table header
 */
export function renderMarkdownFileHeader(file: string): string[] {
  return [
    `**${file}**`,
    `| ID | Time | T | Title | Read | Work |`,
    `|----|------|---|-------|------|------|`
  ];
}

/**
 * Render markdown table row for observation
 */
export function renderMarkdownTableRow(
  obs: Observation,
  timeDisplay: string,
  config: ContextConfig
): string {
  const title = obs.title || 'Untitled';
  const icon = ModeManager.getInstance().getTypeIcon(obs.type);
  const { readTokens, discoveryDisplay } = formatObservationTokenDisplay(obs, config);

  const readCol = config.showReadTokens ? `~${readTokens}` : '';
  const workCol = config.showWorkTokens ? discoveryDisplay : '';

  return `| #${obs.id} | ${timeDisplay || '"'} | ${icon} | ${title} | ${readCol} | ${workCol} |`;
}

/**
 * Render markdown full observation
 */
export function renderMarkdownFullObservation(
  obs: Observation,
  timeDisplay: string,
  detailField: string | null,
  config: ContextConfig
): string[] {
  const output: string[] = [];
  const title = obs.title || 'Untitled';
  const icon = ModeManager.getInstance().getTypeIcon(obs.type);
  const { readTokens, discoveryDisplay } = formatObservationTokenDisplay(obs, config);

  output.push(`**#${obs.id}** ${timeDisplay || '"'} ${icon} **${title}**`);
  if (detailField) {
    output.push('');
    output.push(detailField);
    output.push('');
  }

  const tokenParts: string[] = [];
  if (config.showReadTokens) {
    tokenParts.push(`Read: ~${readTokens}`);
  }
  if (config.showWorkTokens) {
    tokenParts.push(`Work: ${discoveryDisplay}`);
  }
  if (tokenParts.length > 0) {
    output.push(tokenParts.join(', '));
  }
  output.push('');

  return output;
}

/**
 * Render markdown summary item in timeline
 */
export function renderMarkdownSummaryItem(
  summary: { id: number; request: string | null },
  formattedTime: string
): string[] {
  const summaryTitle = `${summary.request || 'Session started'} (${formattedTime})`;
  return [
    `**#S${summary.id}** ${summaryTitle}`,
    ''
  ];
}

/**
 * Render markdown summary field
 */
export function renderMarkdownSummaryField(label: string, value: string | null): string[] {
  if (!value) return [];
  return [`**${label}**: ${value}`, ''];
}

/**
 * Render markdown previously section
 */
export function renderMarkdownPreviouslySection(priorMessages: PriorMessages): string[] {
  if (!priorMessages.assistantMessage) return [];

  return [
    '',
    '---',
    '',
    `**Previously**`,
    '',
    `A: ${priorMessages.assistantMessage}`,
    ''
  ];
}

/**
 * Render markdown footer
 */
export function renderMarkdownFooter(totalDiscoveryTokens: number, totalReadTokens: number): string[] {
  const workTokensK = Math.round(totalDiscoveryTokens / 1000);
  return [
    '',
    `Access ${workTokensK}k tokens of past research & decisions for just ${totalReadTokens.toLocaleString()}t. Use MCP search tools to access memories by ID.`
  ];
}

/**
 * Render markdown empty state
 */
export function renderMarkdownEmptyState(project: string): string {
  return `# [${project}] recent context, ${formatHeaderDateTime()}\n\nNo previous sessions found for this project yet.`;
}

// ============================================================================
// SECTION RENDERERS
// ============================================================================

export function renderPreviouslySection(
  priorMessages: PriorMessages,
  useColors: boolean
): string[] {
  if (useColors) {
    return Color.renderColorPreviouslySection(priorMessages);
  }
  return Markdown.renderMarkdownPreviouslySection(priorMessages);
}

/**
 * Render the footer with token savings info
 */
export function renderFooter(
  economics: TokenEconomics,
  config: ContextConfig,
  useColors: boolean
): string[] {
  // Only show footer if we have savings to display
  if (!shouldShowContextEconomics(config) || economics.totalDiscoveryTokens <= 0 || economics.savings <= 0) {
    return [];
  }

  if (useColors) {
    return Color.renderColorFooter(economics.totalDiscoveryTokens, economics.totalReadTokens);
  }
  return Markdown.renderMarkdownFooter(economics.totalDiscoveryTokens, economics.totalReadTokens);
}

export function renderHeader(
  project: string,
  economics: TokenEconomics,
  config: ContextConfig,
  useColors: boolean
): string[] {
  const output: string[] = [];

  // Main header
  if (useColors) {
    output.push(...Color.renderColorHeader(project));
  } else {
    output.push(...Markdown.renderMarkdownHeader(project));
  }

  // Legend
  if (useColors) {
    output.push(...Color.renderColorLegend());
  } else {
    output.push(...Markdown.renderMarkdownLegend());
  }

  // Column key
  if (useColors) {
    output.push(...Color.renderColorColumnKey());
  } else {
    output.push(...Markdown.renderMarkdownColumnKey());
  }

  // Context index instructions
  if (useColors) {
    output.push(...Color.renderColorContextIndex());
  } else {
    output.push(...Markdown.renderMarkdownContextIndex());
  }

  // Context economics
  if (shouldShowContextEconomics(config)) {
    if (useColors) {
      output.push(...Color.renderColorContextEconomics(economics, config));
    } else {
      output.push(...Markdown.renderMarkdownContextEconomics(economics, config));
    }
  }

  return output;
}

export function shouldShowSummary(
  config: ContextConfig,
  mostRecentSummary: SessionSummary | undefined,
  mostRecentObservation: Observation | undefined
): boolean {
  if (!config.showLastSummary || !mostRecentSummary) {
    return false;
  }

  const hasContent = !!(
    mostRecentSummary.investigated ||
    mostRecentSummary.learned ||
    mostRecentSummary.completed ||
    mostRecentSummary.next_steps
  );

  if (!hasContent) {
    return false;
  }

  // Only show if summary is more recent than observations
  if (mostRecentObservation && mostRecentSummary.created_at_epoch <= mostRecentObservation.created_at_epoch) {
    return false;
  }

  return true;
}

/**
 * Render summary fields
 */
export function renderSummaryFields(
  summary: SessionSummary,
  useColors: boolean
): string[] {
  const output: string[] = [];

  if (useColors) {
    output.push(...Color.renderColorSummaryField('Investigated', summary.investigated, colors.blue));
    output.push(...Color.renderColorSummaryField('Learned', summary.learned, colors.yellow));
    output.push(...Color.renderColorSummaryField('Completed', summary.completed, colors.green));
    output.push(...Color.renderColorSummaryField('Next Steps', summary.next_steps, colors.magenta));
  } else {
    output.push(...Markdown.renderMarkdownSummaryField('Investigated', summary.investigated));
    output.push(...Markdown.renderMarkdownSummaryField('Learned', summary.learned));
    output.push(...Markdown.renderMarkdownSummaryField('Completed', summary.completed));
    output.push(...Markdown.renderMarkdownSummaryField('Next Steps', summary.next_steps));
  }

  return output;
}

export function groupTimelineByDay(timeline: TimelineItem[]): Map<string, TimelineItem[]> {
  const itemsByDay = new Map<string, TimelineItem[]>();

  for (const item of timeline) {
    const itemDate = item.type === 'observation' ? item.data.created_at : item.data.displayTime;
    const day = formatDate(itemDate);
    if (!itemsByDay.has(day)) {
      itemsByDay.set(day, []);
    }
    itemsByDay.get(day)!.push(item);
  }

  // Sort days chronologically
  const sortedEntries = Array.from(itemsByDay.entries()).sort((a, b) => {
    const aDate = new Date(a[0]).getTime();
    const bDate = new Date(b[0]).getTime();
    return aDate - bDate;
  });

  return new Map(sortedEntries);
}

/**
 * Get detail field content for full observation display
 */
function getDetailField(obs: Observation, config: ContextConfig): string | null {
  if (config.fullObservationField === 'narrative') {
    return obs.narrative;
  }
  return obs.facts ? parseJsonArray(obs.facts).join('\n') : null;
}

/**
 * Render a single day's timeline items
 */
export function renderDayTimeline(
  day: string,
  dayItems: TimelineItem[],
  fullObservationIds: Set<number>,
  config: ContextConfig,
  cwd: string,
  useColors: boolean
): string[] {
  const output: string[] = [];

  // Day header
  if (useColors) {
    output.push(...Color.renderColorDayHeader(day));
  } else {
    output.push(...Markdown.renderMarkdownDayHeader(day));
  }

  let currentFile: string | null = null;
  let lastTime = '';
  let tableOpen = false;

  for (const item of dayItems) {
    if (item.type === 'summary') {
      // Close any open table before summary
      if (tableOpen) {
        output.push('');
        tableOpen = false;
        currentFile = null;
        lastTime = '';
      }

      const summary = item.data as SummaryTimelineItem;
      const formattedTime = formatDateTime(summary.displayTime);

      if (useColors) {
        output.push(...Color.renderColorSummaryItem(summary, formattedTime));
      } else {
        output.push(...Markdown.renderMarkdownSummaryItem(summary, formattedTime));
      }
    } else {
      const obs = item.data as Observation;
      const file = extractFirstFile(obs.files_modified, cwd, obs.files_read);
      const time = formatTime(obs.created_at);
      const showTime = time !== lastTime;
      const timeDisplay = showTime ? time : '';
      lastTime = time;

      const shouldShowFull = fullObservationIds.has(obs.id);

      // Check if we need a new file section
      if (file !== currentFile) {
        if (tableOpen) {
          output.push('');
        }

        if (useColors) {
          output.push(...Color.renderColorFileHeader(file));
        } else {
          output.push(...Markdown.renderMarkdownFileHeader(file));
        }

        currentFile = file;
        tableOpen = true;
      }

      if (shouldShowFull) {
        const detailField = getDetailField(obs, config);

        if (useColors) {
          output.push(...Color.renderColorFullObservation(obs, time, showTime, detailField, config));
        } else {
          // Close table for full observation in markdown mode
          if (tableOpen && !useColors) {
            output.push('');
            tableOpen = false;
          }
          output.push(...Markdown.renderMarkdownFullObservation(obs, timeDisplay, detailField, config));
          currentFile = null; // Reset to trigger new table header if needed
        }
      } else {
        if (useColors) {
          output.push(Color.renderColorTableRow(obs, time, showTime, config));
        } else {
          output.push(Markdown.renderMarkdownTableRow(obs, timeDisplay, config));
        }
      }
    }
  }

  // Close any remaining open table
  if (tableOpen) {
    output.push('');
  }

  return output;
}

/**
 * Render the complete timeline
 */
export function renderTimeline(
  timeline: TimelineItem[],
  fullObservationIds: Set<number>,
  config: ContextConfig,
  cwd: string,
  useColors: boolean
): string[] {
  const output: string[] = [];
  const itemsByDay = groupTimelineByDay(timeline);

  for (const [day, dayItems] of itemsByDay) {
    output.push(...renderDayTimeline(day, dayItems, fullObservationIds, config, cwd, useColors));
  }

  return output;
}

