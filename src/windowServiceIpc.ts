import { IServerChannel } from "../core/common/ipc";
import { WindowService } from "./windowService";
import { Event } from '../base/event';

export class WindowChannel implements IServerChannel {
  constructor(
    public readonly windowService: WindowService,
  ) {}

  listen(_: unknown, event: string): Event<any> {
    // 暂时不支持
    throw new Error(`Not support listen event currently: ${event}`);
  }

  call(_: unknown, command: string, arg?: any): Promise<any> {
    switch (command) {
      case 'doSomething':
        return Promise.resolve(this.windowService.doSomething());

      default:
        return Promise.reject('无可调用服务！');
    }
  }
}
