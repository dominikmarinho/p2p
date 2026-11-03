import type { HealthService } from './health.service.js';

export class HealthController {
  constructor(private readonly service: HealthService) {}
  live = () => ({ status: 'ok' as const });
  ready = () => this.service.ready();
}
