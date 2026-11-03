import type { HealthRepository } from './health.repository.js';

export class HealthService {
  constructor(private readonly repository: HealthRepository) {}
  async ready() { await this.repository.probe(); return { status: 'ok' as const }; }
}
