import { BlockList, isIP } from 'node:net';
import { z } from 'zod';

export const xuiServerDto = z.object({ name: z.string().trim().min(1).max(100), baseUrl: z.url().max(500), apiToken: z.string().max(4096).optional(), enabled: z.boolean().default(true) }).strict();
export const routeDto = z.object({ channel: z.string().regex(/^[\w-]{1,64}$/), streamId: z.number().int().positive(), serverId: z.uuid(), fallbackServerIds: z.array(z.uuid()).max(3).default([]), enabled: z.boolean().default(true) }).strict();
export const configDto = z.object({ bufferSeconds: z.number().int().min(1).max(120), maxUploadKbps: z.number().int().min(64).max(100000), maxConnectionsPerNode: z.number().int().min(1).max(20), maxPeersPerChannel: z.number().int().min(1).max(1000) }).strict();
export const uuidParams = z.object({ id: z.uuid() });
export const whitelistDto = z.object({ cidr: z.string().refine(validCidr, 'IP/CIDR inválido') }).strict();
export function validCidr(value: string): boolean {
  const [address, bits, extra] = value.split('/');
  if (!address || extra !== undefined || !isIP(address)) return false;
  return bits === undefined || (/^\d+$/.test(bits) && Number(bits) <= (isIP(address) === 4 ? 32 : 128));
}
export function matchesIp(ip: string, cidr: string): boolean {
  const [address, bits] = cidr.split('/');
  if (!address) return false;
  const family = isIP(address) === 4 ? 'ipv4' : 'ipv6';
  const list = new BlockList();
  if (bits === undefined) list.addAddress(address, family); else list.addSubnet(address, Number(bits), family);
  const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return list.check(normalized, isIP(normalized) === 4 ? 'ipv4' : 'ipv6');
}
export type XuiServerInput = z.infer<typeof xuiServerDto>;
export type EngineConfig = z.infer<typeof configDto>;
