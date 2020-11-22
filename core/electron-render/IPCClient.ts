import { IDisposable } from "../../base/interface";
import { VSBuffer } from "../../base/buffer";
import { BufferWriter, serialize } from "../../base/buffer-utils";
import { ChannelClient, ChannelServer, IChannel, IChannelClient, IChannelServer, IMessagePassingProtocol, IServerChannel } from "../common/ipc";
import { Protocol } from "../common/ipc.electron";
import { Event } from '../../base/event';
import { ipcRenderer } from "electron";

export class IPCClient<TContext = string>
  implements IChannelClient, IChannelServer<TContext>, IDisposable {
  private readonly channelClient: ChannelClient;

  private readonly channelServer: ChannelServer<TContext>;

  constructor(protocol: IMessagePassingProtocol, ctx: TContext) {
    const writer = new BufferWriter();
    serialize(writer, ctx);
    protocol.send(writer.buffer);

    this.channelClient = new ChannelClient(protocol);
    this.channelServer = new ChannelServer(protocol, ctx);
  }

  getChannel<T extends IChannel>(channelName: string): T {
    return this.channelClient.getChannel(channelName);
  }

  registerChannel(
    channelName: string,
    channel: IServerChannel<TContext>,
  ): void {
    this.channelServer.registerChannel(channelName, channel);
  }

  dispose(): void {
    this.channelClient.dispose();
    this.channelServer.dispose();
  }
}

export class Client extends IPCClient implements IDisposable {
  private readonly protocol: Protocol;

  private static createProtocol(): Protocol {
    const onMessage = Event.fromNodeEventEmitter<VSBuffer>(
      ipcRenderer,
      'ipc:message',
      (_, message: Buffer) => VSBuffer.wrap(message),
    );
    ipcRenderer.send('ipc:hello');
    return new Protocol(ipcRenderer, onMessage);
  }

  constructor(id: string) {
    const protocol = Client.createProtocol();
    super(protocol, id);
    this.protocol = protocol;
  }

  dispose(): void {
    this.protocol.dispose();
  }
}
