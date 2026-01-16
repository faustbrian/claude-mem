/**
 * Viewer Routes
 *
 * Handles health check, minimal status page, and SSE stream endpoints.
 */

import express, { Request, Response } from 'express';
import { logger } from '../../../../utils/logger.js';
import { SSEBroadcaster } from '../../SSEBroadcaster.js';
import { DatabaseManager } from '../../DatabaseManager.js';
import { SessionManager } from '../../SessionManager.js';
import { BaseRouteHandler } from '../BaseRouteHandler.js';

export class ViewerRoutes extends BaseRouteHandler {
  constructor(
    private sseBroadcaster: SSEBroadcaster,
    private dbManager: DatabaseManager,
    private sessionManager: SessionManager
  ) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.get('/health', this.handleHealth.bind(this));
    app.get('/', this.handleStatusPage.bind(this));
    app.get('/stream', this.handleSSEStream.bind(this));
  }

  /**
   * Health check endpoint
   */
  private handleHealth = this.wrapHandler((req: Request, res: Response): void => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  /**
   * Minimal status page
   */
  private handleStatusPage = this.wrapHandler((req: Request, res: Response): void => {
    const allProjects = this.dbManager.getSessionStore().getAllProjects();
    const isProcessing = this.sessionManager.isAnySessionProcessing();
    const queueDepth = this.sessionManager.getTotalActiveWork();

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude-Mem Worker</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      line-height: 1.6;
      color: #333;
    }
    h1 { color: #2563eb; }
    .status {
      padding: 12px;
      border-radius: 6px;
      background: #f0f9ff;
      border: 1px solid #bfdbfe;
      margin: 20px 0;
    }
    .metric {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .metric:last-child { border-bottom: none; }
    .label { font-weight: 500; }
    .value { color: #6b7280; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    ul { list-style: none; padding: 0; }
    li { padding: 8px; margin: 4px 0; background: #f9fafb; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Claude-Mem Worker</h1>
  <p>Worker service running on port 37777</p>

  <div class="status">
    <div class="metric">
      <span class="label">Status:</span>
      <span class="value">Running</span>
    </div>
    <div class="metric">
      <span class="label">Processing:</span>
      <span class="value">${isProcessing ? 'Active' : 'Idle'}</span>
    </div>
    <div class="metric">
      <span class="label">Queue Depth:</span>
      <span class="value">${queueDepth}</span>
    </div>
    <div class="metric">
      <span class="label">Projects:</span>
      <span class="value">${allProjects.length}</span>
    </div>
  </div>

  <h2>API Endpoints</h2>
  <ul>
    <li><a href="/health">/health</a> - Health check</li>
    <li><a href="/stream">/stream</a> - SSE event stream</li>
    <li><a href="/api/sessions">/api/sessions</a> - Sessions API</li>
    <li><a href="/api/search">/api/search</a> - Search API</li>
  </ul>
</body>
</html>
    `.trim();

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });

  /**
   * SSE stream endpoint
   */
  private handleSSEStream = this.wrapHandler((req: Request, res: Response): void => {
    // Setup SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Add client to broadcaster
    this.sseBroadcaster.addClient(res);

    // Send initial_load event with projects list
    const allProjects = this.dbManager.getSessionStore().getAllProjects();
    this.sseBroadcaster.broadcast({
      type: 'initial_load',
      projects: allProjects,
      timestamp: Date.now()
    });

    // Send initial processing status (based on queue depth + active generators)
    const isProcessing = this.sessionManager.isAnySessionProcessing();
    const queueDepth = this.sessionManager.getTotalActiveWork(); // Includes queued + actively processing
    this.sseBroadcaster.broadcast({
      type: 'processing_status',
      isProcessing,
      queueDepth
    });
  });
}
