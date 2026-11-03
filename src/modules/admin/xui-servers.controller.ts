import type { XuiServersService } from './xui-servers.service.js';
import type { XuiServerInput } from './admin.dto.js';

export class XuiServersController {
  constructor(private readonly service: XuiServersService) {}
  list = () => this.service.list();
  create = (input: XuiServerInput) => this.service.save(input);
  update = (id: string, input: XuiServerInput) => this.service.save(input, id);
  delete = (id: string) => this.service.delete(id);
  testConnection = (id: string) => this.service.testConnection(id);
}
