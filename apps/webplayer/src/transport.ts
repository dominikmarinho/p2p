const configured = (import.meta as ImportMeta & { env?: { VITE_TRANSPORT_MODE?: string } }).env?.VITE_TRANSPORT_MODE;
export const clientTransport: 'http' | 'p2p' | undefined = configured === 'http' || configured === 'p2p' ? configured : undefined;
export const clientLabel = clientTransport === 'http' ? 'HTTP' : clientTransport === 'p2p' ? 'P2P' : 'Compatibilidade';
