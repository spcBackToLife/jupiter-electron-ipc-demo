import { IDisposable } from "../../base/interface";
import { VSBuffer } from "../../base/buffer";
import {Emitter, Event} from '../../base/event';
import { ipcMain } from "electron";
import { ChannelClient, ChannelServer, ClientConnectionEvent, Connection, IChannelServer, IServerChannel } from "../common/ipc";
import { BufferReader, deserialize } from "../../base/buffer-utils";
import { toDisposable } from "../../base/disposable/disposable";
import { Protocol } from "../common/ipc.electron";

interface IIPCEvent {
  event: { sender: Electron.WebContents };
  message: Buffer | null;
}

function createScopedOnMessageEvent(
  senderId: number,
  eventName: string,
): Event<VSBuffer | Buffer> {
  const onMessage = Event.fromNodeEventEmitter<IIPCEvent>(
    ipcMain,
    eventName,
    (event, message) => ({ event, message }),
  );
  const onMessageFromSender = Event.filter(
    onMessage,
    ({ event }) => event.sender.id === senderId,
  );
  // @ts-ignore
  return Event.map(onMessageFromSender, ({ message }) =>
    message ? VSBuffer.wrap(message) : message,
  );
}


class IPCServer<TContext = string>
  implements
    IChannelServer<TContext>,
    IDisposable {

    // 服务端侧可访问的频道
    private readonly channels = new Map<string, IServerChannel<TContext>>();

    // 客户端和服务端的连接
    private readonly _connections = new Set<Connection<TContext>>();

    private readonly _onDidChangeConnections = new Emitter<
      Connection<TContext>
    >();

    // 连接改变的时候触发得事件监听
    readonly onDidChangeConnections: Event<Connection<TContext>> = this
      ._onDidChangeConnections.event;

    // 所有连接
    get connections(): Array<Connection<TContext>> {
      const result: Array<Connection<TContext>> = [];
      this._connections.forEach(ctx => result.push(ctx));
      return result;
    }

    dispose(): void {
      this.channels.clear();
      this._connections.clear();
      this._onDidChangeConnections.dispose();
    }
    registerChannel(
      channelName: string,
      channel: IServerChannel<TContext>,
    ): void {
      this.channels.set(channelName, channel);

      // 同时在所有的连接中，需要注册频道
      this._connections.forEach(connection => {
        connection.channelServer.registerChannel(channelName, channel);
      });
    }

    constructor(onDidClientConnect: Event<ClientConnectionEvent>) {
      onDidClientConnect(({ protocol, onDidClientDisconnect }) => {
        const onFirstMessage = Event.once(protocol.onMessage);
        onFirstMessage(msg => {
          const reader = new BufferReader(msg);
          const ctx = deserialize(reader) as TContext;
          const channelServer = new ChannelServer(protocol, ctx);
          const channelClient = new ChannelClient(protocol);

          this.channels.forEach((channel, name) =>
            channelServer.registerChannel(name, channel),
          );

          const connection: Connection<TContext> = {
            channelServer,
            channelClient,
            ctx,
          };
          this._connections.add(connection);
          // this._onDidChangeConnections.fire(connection);

          onDidClientDisconnect(() => {
            channelServer.dispose();
            channelClient.dispose();
            this._connections.delete(connection);
          });
        });
      });
    }

  }


export class Server extends IPCServer {
  private static readonly Clients: Map<number, IDisposable> = new Map<
    number,
    IDisposable
  >();

  private static getOnDidClientConnect(): Event<ClientConnectionEvent> {
    const onHello = Event.fromNodeEventEmitter<Electron.WebContents>(
      ipcMain,
      'ipc:hello',
      ({ sender }) => sender,
    );

    return Event.map(onHello, webContents => {
      const { id } = webContents;
      const client = Server.Clients.get(id);

      if (client) {
        client.dispose();
      }

      const onDidClientReconnect = new Emitter<void>();
      Server.Clients.set(
        id,
        toDisposable(() => onDidClientReconnect.fire()),
      );

      const onMessage = createScopedOnMessageEvent(id, 'ipc:message') as Event<
        VSBuffer
      >;
      const onDidClientDisconnect = Event.any(
        Event.signal(createScopedOnMessageEvent(id, 'ipc:disconnect')),
        onDidClientReconnect.event,
      );
      const protocol = new Protocol(webContents, onMessage);
      return { protocol, onDidClientDisconnect };
    });
  }

  constructor() {
    super(Server.getOnDidClientConnect());
  }
}

