/**
 * ChromaServerManager - Manages Chroma server lifecycle
 *
 * Spawns and manages a local Chroma server process for vector database operations.
 * Provides health checking and graceful shutdown capabilities.
 */

import { spawn, ChildProcess } from 'child_process';
import { logger } from '../../utils/logger.js';

export class ChromaServerManager {
  private process: ChildProcess | null = null;
  private port: number;
  private host: string;
  private dataDir: string;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(dataDir: string, port: number = 8000) {
    this.dataDir = dataDir;
    this.port = port;
    this.host = '127.0.0.1';
  }

  /**
   * Start the Chroma server process
   */
  async start(): Promise<void> {
    if (this.isRunning()) {
      logger.debug('CHROMA_SERVER', 'Server already running', { port: this.port });
      return;
    }

    logger.info('CHROMA_SERVER', 'Starting Chroma server', {
      dataDir: this.dataDir,
      port: this.port,
      host: this.host
    });

    try {
      this.process = spawn('chroma', [
        'run',
        '--path', this.dataDir,
        '--port', String(this.port),
        '--host', this.host
      ], {
        detached: true,
        stdio: 'ignore'
      });

      this.process.unref();

      logger.debug('CHROMA_SERVER', 'Chroma process spawned', { pid: this.process.pid });

      // Wait for server to be ready
      await this.waitForHealth(30000);

      logger.info('CHROMA_SERVER', 'Chroma server ready', { port: this.port });
    } catch (error) {
      logger.error('CHROMA_SERVER', 'Failed to start Chroma server', {}, error as Error);
      throw new Error(`Chroma server start failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Stop the Chroma server process
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    logger.info('CHROMA_SERVER', 'Stopping Chroma server', { pid: this.process.pid });

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    try {
      this.process.kill('SIGTERM');

      // Wait up to 5 seconds for graceful shutdown
      await this.waitForExit(5000);

      if (this.process && !this.process.killed) {
        logger.warn('CHROMA_SERVER', 'Forcefully killing Chroma server', { pid: this.process.pid });
        this.process.kill('SIGKILL');
      }

      this.process = null;
      logger.info('CHROMA_SERVER', 'Chroma server stopped');
    } catch (error) {
      logger.error('CHROMA_SERVER', 'Error stopping Chroma server', {}, error as Error);
      throw error;
    }
  }

  /**
   * Check if Chroma server is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`http://${this.host}:${this.port}/api/v1/heartbeat`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check if Chroma process is running
   */
  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  /**
   * Get server URL
   */
  getServerUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  /**
   * Wait for server to become healthy
   */
  private async waitForHealth(timeoutMs: number): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 500;

    while (Date.now() - startTime < timeoutMs) {
      const healthy = await this.healthCheck();
      if (healthy) {
        return;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Chroma server health check timeout after ${timeoutMs}ms`);
  }

  /**
   * Wait for process to exit
   */
  private async waitForExit(timeoutMs: number): Promise<void> {
    if (!this.process) {
      return;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve();
      }, timeoutMs);

      this.process!.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}
