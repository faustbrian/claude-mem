/**
 * BunServer - Native Bun.serve() implementation
 *
 * Replaces Express with Bun's native HTTP server for better performance
 * and simpler architecture.
 */

import type { Server as BunServerType } from 'bun';
import * as fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { getPackageRoot } from '../../shared/paths.js';

// Build-time injected version constant
declare const __DEFAULT_PACKAGE_VERSION__: string;
const BUILT_IN_VERSION = typeof __DEFAULT_PACKAGE_VERSION__ !== 'undefined'
  ? __DEFAULT_PACKAGE_VERSION__
  : 'development';

/**
 * Options for initializing the server
 */
export interface ServerOptions {
  getInitializationComplete: () => boolean;
  getMcpReady: () => boolean;
  onShutdown: () => Promise<void>;
  onRestart: () => Promise<void>;
  getRouteHandler: () => (req: Request) => Promise<Response> | Response;
}

/**
 * Bun native HTTP server wrapper
 */
export class BunServer {
  private server: BunServerType | null = null;
  private readonly options: ServerOptions;
  private readonly startTime: number = Date.now();
  private readonly packageRoot: string;

  constructor(options: ServerOptions) {
    this.options = options;
    this.packageRoot = getPackageRoot();
  }

  /**
   * Start listening on the specified host and port
   */
  async listen(port: number, host: string): Promise<void> {
    this.server = Bun.serve({
      port,
      hostname: host,
      fetch: this.handleRequest.bind(this),
    });

    logger.info('SYSTEM', 'HTTP server started', { host, port, pid: process.pid });
  }

  /**
   * Close the HTTP server
   */
  async close(): Promise<void> {
    if (!this.server) return;

    this.server.stop();
    this.server = null;
    logger.info('SYSTEM', 'HTTP server closed');
  }

  /**
   * Main request handler - routes all requests
   */
  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Serve static files first
    if (pathname.startsWith('/ui/') || this.isStaticAsset(pathname)) {
      const staticResponse = this.serveStatic(pathname);
      if (staticResponse) return staticResponse;
    }

    // Health check endpoint
    if (pathname === '/api/health') {
      return Response.json({
        status: 'ok',
        build: 'BUN-001',
        managed: process.env.CLAUDE_MEM_MANAGED === 'true',
        hasIpc: typeof process.send === 'function',
        platform: process.platform,
        pid: process.pid,
        initialized: this.options.getInitializationComplete(),
        mcpReady: this.options.getMcpReady(),
      });
    }

    // Readiness check endpoint
    if (pathname === '/api/readiness') {
      if (this.options.getInitializationComplete()) {
        return Response.json({
          status: 'ready',
          mcpReady: this.options.getMcpReady(),
        });
      } else {
        return Response.json({
          status: 'initializing',
          message: 'Worker is still initializing, please retry',
        }, { status: 503 });
      }
    }

    // Version endpoint
    if (pathname === '/api/version') {
      return Response.json({ version: BUILT_IN_VERSION });
    }

    // Instructions endpoint
    if (pathname === '/api/instructions') {
      return this.handleInstructions(url);
    }

    // Admin endpoints (localhost-only)
    if (pathname === '/api/admin/restart' && req.method === 'POST') {
      if (!this.isLocalhost(req)) {
        return Response.json({
          error: 'Forbidden',
          message: 'Admin endpoints are only accessible from localhost'
        }, { status: 403 });
      }

      // Handle restart
      const isWindowsManaged = process.platform === 'win32' &&
        process.env.CLAUDE_MEM_MANAGED === 'true' &&
        process.send;

      if (isWindowsManaged) {
        logger.info('SYSTEM', 'Sending restart request to wrapper');
        process.send!({ type: 'restart' });
      } else {
        setTimeout(async () => {
          await this.options.onRestart();
        }, 100);
      }

      return Response.json({ status: 'restarting' });
    }

    if (pathname === '/api/admin/shutdown' && req.method === 'POST') {
      if (!this.isLocalhost(req)) {
        return Response.json({
          error: 'Forbidden',
          message: 'Admin endpoints are only accessible from localhost'
        }, { status: 403 });
      }

      // Handle shutdown
      const isWindowsManaged = process.platform === 'win32' &&
        process.env.CLAUDE_MEM_MANAGED === 'true' &&
        process.send;

      if (isWindowsManaged) {
        logger.info('SYSTEM', 'Sending shutdown request to wrapper');
        process.send!({ type: 'shutdown' });
      } else {
        setTimeout(async () => {
          await this.options.onShutdown();
        }, 100);
      }

      return Response.json({ status: 'shutting_down' });
    }

    // Delegate to route handler
    return await this.options.getRouteHandler()(req);
  }

  /**
   * Check if request is from localhost
   */
  private isLocalhost(req: Request): boolean {
    const url = new URL(req.url);
    const hostname = url.hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  }

  /**
   * Check if path is a static asset
   */
  private isStaticAsset(pathname: string): boolean {
    const staticExtensions = ['.html', '.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.woff', '.woff2', '.ttf', '.eot'];
    return staticExtensions.some(ext => pathname.endsWith(ext));
  }

  /**
   * Serve static files
   */
  private serveStatic(pathname: string): Response | null {
    // Try different potential paths
    const possiblePaths = [
      path.join(this.packageRoot, 'ui', pathname.replace('/ui/', '')),
      path.join(this.packageRoot, 'plugin', 'ui', pathname),
      path.join(this.packageRoot, pathname.slice(1)), // Remove leading slash
    ];

    for (const filePath of possiblePaths) {
      try {
        if (fs.existsSync(filePath)) {
          const file = Bun.file(filePath);
          return new Response(file);
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  /**
   * Handle instructions endpoint
   */
  private async handleInstructions(url: URL): Promise<Response> {
    const topic = url.searchParams.get('topic') || 'all';
    const operation = url.searchParams.get('operation');

    try {
      let content: string;

      if (operation) {
        const operationPath = path.join(__dirname, '../skills/mem-search/operations', `${operation}.md`);
        content = await fs.promises.readFile(operationPath, 'utf-8');
      } else {
        const skillPath = path.join(__dirname, '../skills/mem-search/SKILL.md');
        const fullContent = await fs.promises.readFile(skillPath, 'utf-8');
        content = this.extractInstructionSection(fullContent, topic);
      }

      return Response.json({
        content: [{ type: 'text', text: content }]
      });
    } catch (error) {
      return Response.json({ error: 'Instruction not found' }, { status: 404 });
    }
  }

  /**
   * Extract a specific section from instruction content
   */
  private extractInstructionSection(content: string, topic: string): string {
    const sections: Record<string, string> = {
      'workflow': this.extractBetween(content, '## The Workflow', '## Search Parameters'),
      'search_params': this.extractBetween(content, '## Search Parameters', '## Examples'),
      'examples': this.extractBetween(content, '## Examples', '## Why This Workflow'),
      'all': content
    };

    return sections[topic] || sections['all'];
  }

  /**
   * Extract text between two markers
   */
  private extractBetween(content: string, startMarker: string, endMarker: string): string {
    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);

    if (startIdx === -1) return content;
    if (endIdx === -1) return content.substring(startIdx);

    return content.substring(startIdx, endIdx).trim();
  }
}
