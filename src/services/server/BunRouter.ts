/**
 * BunRouter - Handles application routes for Bun server
 *
 * Simplified router that handles core endpoints
 */

import { logger } from '../../utils/logger.js';
import type { BunSSEBroadcaster } from '../worker/BunSSEBroadcaster.js';
import type { DatabaseManager } from '../worker/DatabaseManager.js';
import type { SessionManager } from '../worker/SessionManager.js';
import type { SDKAgent } from '../worker/SDKAgent.js';

export class BunRouter {
  constructor(
    private sseBroadcaster: BunSSEBroadcaster,
    private dbManager: DatabaseManager,
    private sessionManager: SessionManager,
    private sdkAgent: SDKAgent
  ) {}

  /**
   * Main route handler
   */
  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname;
    const method = req.method;

    // Root - serve viewer UI
    if (pathname === '/') {
      return this.serveViewerUI();
    }

    // Health endpoint
    if (pathname === '/health') {
      return Response.json({ status: 'ok', timestamp: Date.now() });
    }

    // SSE stream endpoint
    if (pathname === '/stream') {
      return this.handleSSEStream();
    }

    // Session routes
    if (pathname.startsWith('/api/sessions')) {
      return this.handleSessionRoute(pathname, method, req);
    }

    // Search/context routes
    if (pathname.startsWith('/api/context') || pathname.startsWith('/api/search')) {
      return this.handleSearchRoute(pathname, method, req);
    }

    // Data routes
    if (pathname.startsWith('/api/data') || pathname.startsWith('/api/observations')) {
      return this.handleDataRoute(pathname, method, req);
    }

    // Settings routes
    if (pathname.startsWith('/api/settings')) {
      return this.handleSettingsRoute(pathname, method, req);
    }

    // Logs routes
    if (pathname.startsWith('/api/logs')) {
      return this.handleLogsRoute(pathname, method, req);
    }

    // 404 - Not Found
    return Response.json({ error: 'Not Found' }, { status: 404 });
  }

  /**
   * Serve viewer UI HTML
   */
  private serveViewerUI(): Response {
    // For now, return minimal HTML
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Claude-Mem Worker</title>
</head>
<body>
  <h1>Claude-Mem Worker Running</h1>
  <p>API: <a href="/api/health">/api/health</a></p>
  <p>Stream: <a href="/stream">/stream</a></p>
</body>
</html>
    `;
    return new Response(html, {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  /**
   * Handle SSE stream
   */
  private handleSSEStream(): Response {
    const stream = this.sseBroadcaster.createStream();

    // Send initial load event after stream is created
    setTimeout(() => {
      const allProjects = this.dbManager.getSessionStore().getAllProjects();
      this.sseBroadcaster.broadcast({
        type: 'initial_load',
        projects: allProjects,
        timestamp: Date.now()
      });

      const isProcessing = this.sessionManager.isAnySessionProcessing();
      const queueDepth = this.sessionManager.getTotalActiveWork();
      this.sseBroadcaster.broadcast({
        type: 'processing_status',
        isProcessing,
        queueDepth
      });
    }, 10);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  /**
   * Handle session routes
   */
  private async handleSessionRoute(pathname: string, method: string, req: Request): Promise<Response> {
    // Session init
    if (pathname === '/api/sessions/init' && method === 'POST') {
      try {
        const body = await req.json();
        const agent = this.sdkAgent;
        const result = await agent.init(body.project, body.contentSessionId);
        return Response.json(result);
      } catch (error: any) {
        return Response.json({ error: error.message }, { status: 500 });
      }
    }

    // Observations
    if (pathname === '/api/sessions/observations' && method === 'POST') {
      try {
        const body = await req.json();
        const agent = this.sdkAgent;
        await agent.queueObservation(body);
        return Response.json({ status: 'queued' });
      } catch (error: any) {
        return Response.json({ error: error.message }, { status: 500 });
      }
    }

    // Summarize
    if (pathname === '/api/sessions/summarize' && method === 'POST') {
      try {
        const body = await req.json();
        const agent = this.sdkAgent;
        await agent.queueSummarize(body);
        return Response.json({ status: 'queued' });
      } catch (error: any) {
        return Response.json({ error: error.message }, { status: 500 });
      }
    }

    // Complete session
    if (pathname === '/api/sessions/complete' && method === 'POST') {
      try {
        const body = await req.json();
        await this.sessionManager.markSessionComplete(body.contentSessionId);
        return Response.json({ status: 'completed' });
      } catch (error: any) {
        return Response.json({ error: error.message }, { status: 500 });
      }
    }

    return Response.json({ error: 'Not implemented' }, { status: 501 });
  }

  /**
   * Handle search/context routes
   */
  private async handleSearchRoute(pathname: string, method: string, req: Request): Promise<Response> {
    // Context inject
    if (pathname === '/api/context/inject' && method === 'GET') {
      try {
        const url = new URL(req.url);
        const project = url.searchParams.get('project');
        if (!project) {
          return Response.json({ error: 'Missing project parameter' }, { status: 400 });
        }

        // For now, return minimal context
        return Response.json({
          context: `# Project: ${project}\n\nContext loading...`
        });
      } catch (error: any) {
        return Response.json({ error: error.message }, { status: 500 });
      }
    }

    return Response.json({ error: 'Not implemented' }, { status: 501 });
  }

  /**
   * Handle data routes
   */
  private async handleDataRoute(pathname: string, method: string, req: Request): Promise<Response> {
    return Response.json({ error: 'Not implemented' }, { status: 501 });
  }

  /**
   * Handle settings routes
   */
  private async handleSettingsRoute(pathname: string, method: string, req: Request): Promise<Response> {
    return Response.json({ error: 'Not implemented' }, { status: 501 });
  }

  /**
   * Handle logs routes
   */
  private async handleLogsRoute(pathname: string, method: string, req: Request): Promise<Response> {
    return Response.json({ error: 'Not implemented' }, { status: 501 });
  }
}
