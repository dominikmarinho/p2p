export type ContentKind = 'live' | 'movie' | 'series';
export interface Account { username: string; accountId: string; expiresAt: number; maxConnections: number }
export interface CatalogItem { id: string; name: string; categoryId: string; image: string; kind: ContentKind; extension: string }
export interface Playback { url: string; directUrl?: string; statsPath?: string; trackerPath: string; swarmId: string; expiresAt: number; isLive: boolean; isHls: boolean; iceServers: RTCIceServer[]; config?: { bufferSeconds: number; maxConnectionsPerNode: number; maxUploadKbps: number; maxPeersPerChannel: number } }
export interface EpgItem { title: string; description: string; start: string; end: string }
export interface Episode { id: string; name: string; season: string; extension: string }

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/iptv/${path}`, { ...options, credentials: 'same-origin', headers: options.body ? { 'Content-Type': 'application/json' } : {} });
  if (!response.ok) { const error = await response.json() as { message?: string }; throw new Error(error.message ?? 'Falha na conexão'); }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const absoluteUrl = (url: string) => new URL(url, window.location.origin).href;
export const trackerUrl = (path: string) => { const url = new URL(path, window.location.origin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; return url.href; };
