import { ErrorFactory, ServiceErrorHandler } from './asyncErrorHandler';

/**
 * Real-time connection management for Socket.IO and WebRTC
 * Provides robust connection handling with automatic reconnection and state management
 */

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}

export enum MessageType {
  ANALYSIS_UPDATE = 'analysis_update',
  SYSTEM_UPDATE = 'system_update',
  ERROR_NOTIFICATION = 'error_notification',
  HEARTBEAT = 'heartbeat',
  USER_STATUS = 'user_status',
  SYNC_STATUS = 'sync_status',
}

export interface RealTimeMessage<T = any> {
  type: MessageType;
  data: T;
  timestamp: string;
  id: string;
  userId?: string;
}

export interface ConnectionOptions {
  url?: string;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
  heartbeatInterval?: number;
  timeout?: number;
  enableLogging?: boolean;
}

export interface ConnectionStats {
  state: ConnectionState;
  connectedAt?: string;
  lastMessageAt?: string;
  reconnectAttempts: number;
  messagesReceived: number;
  messagesSent: number;
  latency?: number;
}

// Connection event types
export type ConnectionEvent =
  | { type: 'connection-state-changed'; state: ConnectionState; previousState: ConnectionState }
  | { type: 'message-received'; message: RealTimeMessage }
  | { type: 'connection-error'; error: Error }
  | { type: 'reconnect-attempt'; attempt: number; maxAttempts: number }
  | { type: 'latency-update'; latency: number };

export abstract class BaseRealTimeManager {
  protected state: ConnectionState = ConnectionState.DISCONNECTED;
  protected listeners: Map<string, ((event: ConnectionEvent) => void)[]> = new Map();
  protected messageHandlers: Map<MessageType, ((data: any) => void)[]> = new Map();
  protected options: Required<ConnectionOptions>;
  protected stats: ConnectionStats;
  protected reconnectTimer?: NodeJS.Timeout;
  protected heartbeatTimer?: NodeJS.Timeout;
  protected lastHeartbeat?: number;

  constructor(options: ConnectionOptions = {}) {
    this.options = {
      url: options.url || '/socket.io',
      reconnectAttempts: options.reconnectAttempts ?? 5,
      reconnectDelay: options.reconnectDelay ?? 1000,
      maxReconnectDelay: options.maxReconnectDelay ?? 30000,
      heartbeatInterval: options.heartbeatInterval ?? 30000,
      timeout: options.timeout ?? 20000,
      enableLogging: options.enableLogging ?? process.env.NODE_ENV === 'development',
    };

    this.stats = {
      state: ConnectionState.DISCONNECTED,
      reconnectAttempts: 0,
      messagesReceived: 0,
      messagesSent: 0,
    };

    this.setupErrorHandling();
  }

  // Abstract methods to be implemented by concrete classes
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract send(message: RealTimeMessage): Promise<void>;
  protected abstract setupConnection(): Promise<void>;
  protected abstract cleanup(): void;

  // Event management
  subscribe(eventType: string, listener: (event: ConnectionEvent) => void): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType)!.push(listener);

    return () => {
      const handlers = this.listeners.get(eventType);
      if (handlers) {
        const index = handlers.indexOf(listener);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  protected emit(event: ConnectionEvent): void {
    const eventType = event.type;
    const handlers = this.listeners.get(eventType) || this.listeners.get('*') || [];

    handlers.forEach(handler => {
      try {
        handler(event);
      } catch (error) {
        this.log('error', 'Error in event handler', { eventType, error });
      }
    });
  }

  // Message handling
  onMessage<T>(type: MessageType, handler: (data: T) => void): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type)!.push(handler);

    return () => {
      const handlers = this.messageHandlers.get(type);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  protected handleMessage(message: RealTimeMessage): void {
    this.stats.messagesReceived++;
    this.stats.lastMessageAt = new Date().toISOString();

    const handlers = this.messageHandlers.get(message.type) || [];
    handlers.forEach(handler => {
      try {
        handler(message.data);
      } catch (error) {
        this.log('error', 'Error in message handler', { messageType: message.type, error });
      }
    });

    this.emit({ type: 'message-received', message });
  }

  // State management
  protected setState(newState: ConnectionState): void {
    const previousState = this.state;
    this.state = newState;
    this.stats.state = newState;

    if (newState === ConnectionState.CONNECTED) {
      this.stats.connectedAt = new Date().toISOString();
      this.stats.reconnectAttempts = 0;
      this.startHeartbeat();
    } else if (newState === ConnectionState.DISCONNECTED) {
      this.stopHeartbeat();
    }

    this.log('debug', 'Connection state changed', { previousState, newState });
    this.emit({ type: 'connection-state-changed', state: newState, previousState });
  }

  getState(): ConnectionState {
    return this.state;
  }

  getStats(): ConnectionStats {
    return { ...this.stats };
  }

  isConnected(): boolean {
    return this.state === ConnectionState.CONNECTED;
  }

  // Heartbeat management
  protected startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.state === ConnectionState.CONNECTED) {
        this.sendHeartbeat();
      }
    }, this.options.heartbeatInterval);
  }

  protected stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  protected async sendHeartbeat(): Promise<void> {
    try {
      const timestamp = Date.now();
      this.lastHeartbeat = timestamp;

      await this.send({
        type: MessageType.HEARTBEAT,
        data: { timestamp },
        timestamp: new Date().toISOString(),
        id: this.generateMessageId(),
      });
    } catch (error) {
      this.log('warn', 'Heartbeat failed', { error });
      this.handleConnectionError(error as Error);
    }
  }

  protected handleHeartbeatResponse(data: { timestamp: number }): void {
    if (this.lastHeartbeat) {
      const latency = Date.now() - data.timestamp;
      this.stats.latency = latency;
      this.emit({ type: 'latency-update', latency });
    }
  }

  // Reconnection logic
  protected scheduleReconnect(): void {
    if (this.stats.reconnectAttempts >= this.options.reconnectAttempts) {
      this.log('error', 'Max reconnection attempts reached');
      this.setState(ConnectionState.ERROR);
      return;
    }

    const delay = Math.min(
      this.options.reconnectDelay * Math.pow(2, this.stats.reconnectAttempts),
      this.options.maxReconnectDelay
    );

    this.log('info', 'Scheduling reconnection', {
      attempt: this.stats.reconnectAttempts + 1,
      maxAttempts: this.options.reconnectAttempts,
      delay
    });

    this.reconnectTimer = setTimeout(() => {
      this.attemptReconnect();
    }, delay);
  }

  protected async attemptReconnect(): Promise<void> {
    this.stats.reconnectAttempts++;
    this.setState(ConnectionState.RECONNECTING);

    this.emit({
      type: 'reconnect-attempt',
      attempt: this.stats.reconnectAttempts,
      maxAttempts: this.options.reconnectAttempts,
    });

    try {
      await this.setupConnection();
      this.log('info', 'Reconnection successful');
    } catch (error) {
      this.log('warn', 'Reconnection failed', {
        error: (error as Error).message,
        attempt: this.stats.reconnectAttempts
      });
      this.scheduleReconnect();
    }
  }

  protected stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  // Error handling
  protected setupErrorHandling(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.log('info', 'Network came back online');
        if (this.state === ConnectionState.DISCONNECTED || this.state === ConnectionState.ERROR) {
          this.connect().catch(error => {
            this.log('error', 'Failed to reconnect after coming online', { error });
          });
        }
      });

      window.addEventListener('offline', () => {
        this.log('info', 'Network went offline');
        this.setState(ConnectionState.DISCONNECTED);
      });
    }
  }

  protected handleConnectionError(error: Error): void {
    this.log('error', 'Connection error occurred', { error: error.message });
    this.emit({ type: 'connection-error', error });

    if (this.state === ConnectionState.CONNECTED || this.state === ConnectionState.CONNECTING) {
      this.setState(ConnectionState.DISCONNECTED);
      this.scheduleReconnect();
    }
  }

  // Utility methods
  protected generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  protected log(level: 'debug' | 'info' | 'warn' | 'error', message: string, context: any = {}): void {
    if (!this.options.enableLogging && level === 'debug') return;

    const logData = {
      level: level.toUpperCase(),
      timestamp: new Date().toISOString(),
      service: 'RealTimeManager',
      message,
      context: { ...context, state: this.state },
    };

    console[level]('[RealTime]', logData);
  }

  // Public API
  async sendMessage<T>(type: MessageType, data: T, userId?: string): Promise<void> {
    if (!this.isConnected()) {
      throw ErrorFactory.networkError('Cannot send message: not connected');
    }

    const message: RealTimeMessage<T> = {
      type,
      data,
      timestamp: new Date().toISOString(),
      id: this.generateMessageId(),
      userId,
    };

    await this.send(message);
    this.stats.messagesSent++;
  }

  destroy(): void {
    this.stopHeartbeat();
    this.stopReconnect();
    this.cleanup();
    this.listeners.clear();
    this.messageHandlers.clear();
    this.setState(ConnectionState.DISCONNECTED);
    this.log('info', 'RealTimeManager destroyed');
  }
}

// Socket.IO implementation
export class SocketIOManager extends BaseRealTimeManager {
  private socket?: any; // Socket.IO client instance
  private io?: any; // Socket.IO library

  async connect(): Promise<void> {
    if (this.state === ConnectionState.CONNECTING || this.state === ConnectionState.CONNECTED) {
      return;
    }

    this.setState(ConnectionState.CONNECTING);

    try {
      await this.loadSocketIO();
      await this.setupConnection();
    } catch (error) {
      this.setState(ConnectionState.ERROR);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.stopReconnect();
    this.stopHeartbeat();

    if (this.socket) {
      this.socket.disconnect();
      this.socket = undefined;
    }

    this.setState(ConnectionState.DISCONNECTED);
  }

  async send(message: RealTimeMessage): Promise<void> {
    if (!this.socket || !this.isConnected()) {
      throw ErrorFactory.networkError('Socket not connected');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(ErrorFactory.timeoutError('Message send timeout'));
      }, this.options.timeout);

      this.socket.emit('message', message, (ack?: any) => {
        clearTimeout(timeout);
        if (ack?.error) {
          reject(new Error(ack.error));
        } else {
          resolve();
        }
      });
    });
  }

  protected async setupConnection(): Promise<void> {
    if (!this.io) {
      throw new Error('Socket.IO library not loaded');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(ErrorFactory.timeoutError('Connection timeout'));
      }, this.options.timeout);

      this.socket = this.io(this.options.url, {
        transports: ['websocket', 'polling'],
        upgrade: true,
        rememberUpgrade: true,
        autoConnect: true,
      });

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        this.setState(ConnectionState.CONNECTED);
        this.log('info', 'Socket.IO connected', { id: this.socket.id });
        resolve();
      });

      this.socket.on('disconnect', (reason: string) => {
        this.log('info', 'Socket.IO disconnected', { reason });
        this.setState(ConnectionState.DISCONNECTED);

        // Auto-reconnect unless explicitly disconnected
        if (reason !== 'io client disconnect') {
          this.scheduleReconnect();
        }
      });

      this.socket.on('connect_error', (error: Error) => {
        clearTimeout(timeout);
        this.handleConnectionError(error);
        reject(error);
      });

      this.socket.on('message', (message: RealTimeMessage) => {
        if (message.type === MessageType.HEARTBEAT) {
          this.handleHeartbeatResponse(message.data);
        } else {
          this.handleMessage(message);
        }
      });

      this.socket.on('error', (error: Error) => {
        this.handleConnectionError(error);
      });

      // Start connecting
      if (!this.socket.connected) {
        this.socket.connect();
      }
    });
  }

  protected cleanup(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = undefined;
    }
  }

  private async loadSocketIO(): Promise<void> {
    try {
      // Dynamic import of Socket.IO client
      const { io } = await import('socket.io-client');
      this.io = io;
    } catch (error) {
      throw ErrorFactory.networkError('Failed to load Socket.IO client library');
    }
  }
}

// WebSocket implementation (fallback)
export class WebSocketManager extends BaseRealTimeManager {
  private ws?: WebSocket;
  private pingInterval?: NodeJS.Timeout;

  async connect(): Promise<void> {
    if (this.state === ConnectionState.CONNECTING || this.state === ConnectionState.CONNECTED) {
      return;
    }

    this.setState(ConnectionState.CONNECTING);

    try {
      await this.setupConnection();
    } catch (error) {
      this.setState(ConnectionState.ERROR);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.stopReconnect();
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = undefined;
    }

    this.setState(ConnectionState.DISCONNECTED);
  }

  async send(message: RealTimeMessage): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw ErrorFactory.networkError('WebSocket not connected');
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws!.send(JSON.stringify(message));
        resolve();
      } catch (error) {
        reject(ErrorFactory.networkError(`Failed to send WebSocket message: ${error}`));
      }
    });
  }

  protected async setupConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.options.url.replace(/^http/, 'ws') + '/ws';
      const timeout = setTimeout(() => {
        reject(ErrorFactory.timeoutError('WebSocket connection timeout'));
      }, this.options.timeout);

      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          clearTimeout(timeout);
          this.setState(ConnectionState.CONNECTED);
          this.log('info', 'WebSocket connected');
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: RealTimeMessage = JSON.parse(event.data);
            if (message.type === MessageType.HEARTBEAT) {
              this.handleHeartbeatResponse(message.data);
            } else {
              this.handleMessage(message);
            }
          } catch (error) {
            this.log('warn', 'Failed to parse WebSocket message', { error });
          }
        };

        this.ws.onclose = (event) => {
          this.log('info', 'WebSocket disconnected', {
            code: event.code,
            reason: event.reason
          });

          this.setState(ConnectionState.DISCONNECTED);

          // Auto-reconnect unless explicitly closed
          if (event.code !== 1000) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (event) => {
          clearTimeout(timeout);
          const error = ErrorFactory.networkError('WebSocket error occurred');
          this.handleConnectionError(error);
          reject(error);
        };
      } catch (error) {
        clearTimeout(timeout);
        reject(ErrorFactory.networkError(`Failed to create WebSocket: ${error}`));
      }
    });
  }

  protected cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;

      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, 'Client cleanup');
      }
      this.ws = undefined;
    }
  }
}

// Real-time manager factory
export type RealTimeManagerType = 'socketio' | 'websocket' | 'auto';

export class RealTimeManagerFactory {
  static async create(
    type: RealTimeManagerType = 'auto',
    options: ConnectionOptions = {}
  ): Promise<BaseRealTimeManager> {
    const finalType = type === 'auto' ? await this.detectBestOption() : type;

    switch (finalType) {
      case 'socketio':
        return new SocketIOManager(options);
      case 'websocket':
        return new WebSocketManager(options);
      default:
        throw new Error(`Unsupported real-time manager type: ${finalType}`);
    }
  }

  private static async detectBestOption(): Promise<'socketio' | 'websocket'> {
    // Try to detect if Socket.IO is available
    try {
      await import('socket.io-client');
      return 'socketio';
    } catch {
      return 'websocket';
    }
  }
}

// Singleton instance management
let globalRealTimeManager: BaseRealTimeManager | null = null;

export async function getRealTimeManager(
  type: RealTimeManagerType = 'auto',
  options: ConnectionOptions = {}
): Promise<BaseRealTimeManager> {
  if (!globalRealTimeManager) {
    globalRealTimeManager = await RealTimeManagerFactory.create(type, options);
  }
  return globalRealTimeManager;
}

export function destroyRealTimeManager(): void {
  if (globalRealTimeManager) {
    globalRealTimeManager.destroy();
    globalRealTimeManager = null;
  }
}

export default {
  BaseRealTimeManager,
  SocketIOManager,
  WebSocketManager,
  RealTimeManagerFactory,
  getRealTimeManager,
  destroyRealTimeManager,
  ConnectionState,
  MessageType,
};