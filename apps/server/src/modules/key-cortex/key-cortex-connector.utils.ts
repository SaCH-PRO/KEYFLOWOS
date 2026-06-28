import { ConnectorCommand, ConnectorResult } from './key-cortex-connector.types';

export function connectorOk(
  command: ConnectorCommand,
  start: number,
  data: unknown,
): ConnectorResult {
  return {
    success: true,
    data,
    executionTimeMs: Date.now() - start,
    command,
  };
}

export function connectorFail(
  command: ConnectorCommand,
  start: number,
  error: string,
): ConnectorResult {
  return {
    success: false,
    error,
    executionTimeMs: Date.now() - start,
    command,
  };
}

export function generateCorrelationId(): string {
  return `kc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
