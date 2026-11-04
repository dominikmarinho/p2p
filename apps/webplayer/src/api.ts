import { clientTransport } from './transport.js';
export type ContentKind = 'live' | 'movie' | 'series';
export interface Account { username: string; accountId: string; expiresAt: number; maxConnections: number; p2pRequired?: boolean }
export interface CatalogItem { id: string; name: string; categoryId: string; image: string; kind: ContentKind; extension: string }
export interface Playback { startupAttempt?: string; seedRole?: 'replica'; transport?: 'http' | 'p2p'; url: string; directUrl?: string; statsPath?: string; telemetryPath?: string; trackerPath: string; swarmId: string; expiresAt: number; isLive: boolean; isHls: boolean; iceServers: RTCIceServer[]; delivery?: { mode: 'p2p-first' | 'p2p-only'; seedPath: string; segmentTimeoutMs: number; recoveryMs: number }; config?: { bufferSeconds: number; maxConnectionsPerNode: number; maxUploadKbps: number; maxPeersPerChannel: number } }
export interface EpgItem { title: string; description: string; start: string; end: string }
export interface Episode { id: string; name: string; season: string; extension: string }

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/iptv/${path}`, { ...options, credentials: 'same-origin', headers: options.body ? { 'Content-Type': 'application/json' } : {} });
  if (!response.ok) { const error = await response.json() as { message?: string }; throw new Error(error.message ?? 'Falha na conexão'); }
  if (response.status === 204) return undefined as T;
  const data = await response.json() as T;
  if (path === 'playback' && clientTransport && (data as Playback).transport !== clientTransport) throw new Error('A API não confirmou o transporte deste cliente. Atualize a página ou tente novamente.');
  return data;
}
export const absoluteUrl = (url: string) => new URL(url, window.location.origin).href;
export const trackerUrl = (path: string) => { const url = new URL(path, window.location.origin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; return url.href; };
