**你也可以在你的 Electron 中使用 Vscode 的通信机制：从零到一实现 Vscode 通信机制**


`Electron`是多进程的，因此，在写应用的时候少不了的就是进程间的通信，尤其是主进程与渲染进程之间的通信。但是如果不好好设计通信机制，那么，在应用里的通信就会混乱不堪，无法管理，开发 `Electron` 的同学可能深有体会。

我们举个例子，来看在 `传统 Electron`中和`Jupiter Electron`中通信的样子：

### 示例: 窗口发消息给主进程，做一件事情，并返回一个结果：“完成”。

在 `Electron` 中，我们可能需要这么做：

【主进程】

```typescript

// 做事情
const doSomething = (...params) => {
  console.log('do some sync things');
  return Promise.resolve('完成');
}
app.on('ready', () => {
  const win = new BrowserWindow({});
  ipcMain.on('dosomething', async (e, message) => {
    const result = await doSomething(message.params);
    // 返回结果(渲染进程需要传递请求id过来确保频道通信的唯一性)
    win.webContents.send(`dosomething_${message.requestId}`, result);
  })
})
```

【渲染进程】
```typescript
const doSomething = () => {
  return new Promise((resolve, reject) => {
    const requestId = new Date().getTime();
    // 注意只监听一次返回就好了
    ipcRenderer.once(`dosomething_${requestId}`, (result) => {
       console.log('result:', result);
       resolve(result);
    })
    // 发送消息-dosomething
    ipcRenderer.send('dosomething', {
      requestId,
      params: {...}
    })
  })
}
...
doSomething();
```
> 很明显的一个问题是，如果主进程执行失败了，还得把失败信息返回回来，做下处理。

上述传统的 Electron 通信写法其实还有不少问题，这里就不再补充了。

我们在 `Jupiter Electron` 中是怎么样的呢?

【主进程】
```typescript
const doSomething = (params) => {
  console.log('do something');
  return Promise.resolve('完成');
}
```

【渲染进程】

```typescript
 import bridge from '@jupiter-electron/runtime';

 export const doAthing = () => {
   return bridge.call('doSomething', params)
     .catch((err) => console.log('main exec error:', err));
 }

 doAthing();
```

> - 不用担心唯一性，内部机制已处理。
> - 不用担心失败异常怎么处理返回给前端，内部机制会把错误返回给渲染进程。
> - 通信压缩优化？不用担心，已处理。

可以发现，其实在 `Jupiter Electron`中，通信，则是一件非常简单的事情，主进程、渲染进程通信；窗口间通信。

那这样的机制是怎么实现的呢，背后设计是什么？

其实，通信机制是基于 Vsocde 源码的机制抽象出来的，下面，就对背后的设计机制进行解读，带着大家一起来实现一套 IPC 通信机制。

### 设计通信机制目标是什么？进程通信用什么？
首先，进程通信，我们肯定还是用 `Electron` 中的 `webContents.send`、`ipcRender.send`、`ipcMain.on`，我们设计通信机制的目标是：
- 简化我们的通信流程
- 保证通信的稳定性
- 提高通信的质量
- 提高通信效率，降低资源使用

设计通信机制，就不得不说，我们在`Electron`中的通信是为了什么，有什么特征。

### 通信机制设计

由于`Electron`多进程特征，有时候做一件事情，就不得不需要多进程协作，因此，我们需要通信。

一般，我们会有这些特征场景：

- 「渲染进程」期望「主进程」做一件事情，并返回执行结果。
- 「渲染进程」通知「主进程」一个消息，不需要返回结果。
- 「主进程」期望「渲染进程」做一件事情，并返回执行结果。
- 「渲染进程」期望「渲染进程」做一件事情，并返回执行结果。
- 「渲染进程」会监听来自于「主进程」的消息。

总体来说，基于上述特征，我们总结成：**服务化**，这也是我提出的在`Electron`开发与`Web`的差异的另一个特点。

**服务化** 的含义即：提供服务
- 当你的「渲染进程」期望「主进程」做一件事情，并返回执行结果时，「主进程」需要做的事情，既可以抽象成对应的服务，主进程负责提供服务。
- 当你的「主进程」期望「渲染进程」做一件事情，并返回执行结果时，则「渲染进程」需要做的事情，则可以抽象成对应的服务，渲染进程负责提供服务。

因此，我们可以设计成如下形式：
![](https://tech-proxy.bytedance.net/tos/images/1606038086083_a6c382e4d77c34a7552a09f2a9e17f40.png)

> 服务端可以是「渲染进程」、也可以是「主进程」，取决于谁提供服务给谁。

可以看到，服务端提供 n 个服务供客户端访问。但这样有一个问题，这里，服务端提供的服务，是所有客户端都能访问的，就会有问题，就好比：支付宝为所有用户提供了基础服务，比如：电费、税费、社保查询服务，但有些服务可能只有特定人群能访问，比如：优选100% 赚钱的基金服务。

因此，我们这样的设计就无法满足这个要求，因此我们需要做一个调整：
![](https://tech-proxy.bytedance.net/tos/images/1606038682993_08a370b9997b5473e370212960e1e953.png)

我们增加了 频道服务的概念，每个客户端基于频道来访问服务，比如：
- 客户端1 访问了 频道服务1，客服端2 访问 频道服务2
- 频道服务1和2都有通用的服务，也有自己的特权服务。
- 客服端访问服务的时候，会为每个客户，生成一个频道，来给他提供他具有的服务
- 在为客服创建对应的频道服务的时候，会将服务端通用服务注册到频道中，也会根据用户的特点，注册其特有的服务。

通过以上模式，解决了上述问题，但又带来了一些问题：

用户每一次访问服务的时候，都去新建一个频道服务吗？

按照上述逻辑，的确会是这样，因此，为了解决这个问题，我们需要如下设计：

![](https://tech-proxy.bytedance.net/tos/images/1606039758948_4e8ed7445f492045924b53a2600aa346.png)

我们在服务端，新加一个概念，叫连接（Connection），客户端初始化的时候，可以发起通信连接，此时就会去新建一个频道服务，并存储在服务端，客户端下一次发起服务访问请求的时候，直接去获取频道服务，去那相应的服务进行执行。

这样的方案，看起来完美了，但还有一个问题，上述方案，我们可以适用如下场景：
- 「渲染进程」期望「主进程」做一件事情，并返回执行结果。
那如果是这样的设计，又如何去满足：
- 「主进程」期望「渲染进程」做一件事情，并返回执行结果。

这好像是「服务端」和「客户端」互换了身份。如何让这两种情况同时存在呢？

我们可以做如下设计：
![](https://tech-proxy.bytedance.net/tos/images/1606040628300_33957d6c54a1d9c7b6543a662db00db3.png)

我们在服务端连接上增加「频道客户端」，在客户端增加「频道服务」，从而客户端可访问服务端频道服务中的服务，在服务端，也可以调用客户端里频道服务的服务，从而实现上述问题。

到此，我们对 vscode 整个通信机制的设计解析基本完成，接下来就是具体实现，当然，在实现的过程中，我们还需要去考虑：
- 通信消息的 Buffer 处理
- 通信时执行异常处理
- 通信的唯一性保证


### 通信机制实现


上面在表述中，我们有提到服务，也有提到频道， 我们在这里统一概念：
- 一个频道提供一个服务，服务即频道
后续统一使用「频道」来表示一个「服务」

我们来梳理下，在上述流程中，我们出现的一些概念。

- 服务端 -> IPCServer
  - 即图中最外层的服务端，用于管理所有连接的
- 客户端 -> IPCClient
  - 即图中最外层的客户端，用于建立连接，统一收发消息、处理消息
- 连接 -> Connection
- 频道服务端 -> ChannelServer
  - 提供服务的一端
- 频道客户端 -> ChannelClient
  - 「频道客户端」即访问服务端某个频道（服务）的一端
- 服务端频道 -> ServerChannel
  - 频道服务端注册的频道（服务）即「服务端频道」

当然，在实现 vscode 通信机制之前，其实还有不少必修课，但这些会在后续为大家一一讲解，现在可以理解他们的作用，并拿来使用即可， **不影响对 IPC机制的使用与理解**。

我们在开始 vscode 通信设计之前，需要为大家提供一些基础工具类：

```
- 「cancelablePromise/」 可取消的 promise
- 「disposable/」 监听资源释放基类
- 「buffer、buffer-utils」 对消息的 buffer 处理
- 「events」 是 vscode 自己实现的事件类、也是一个对事件做装饰的类、很赞的！！
- 「iterator」 迭代器，用于 linkedlist 数据结构迭代
- 「linkedlist」 js 的双链数据结构实现
- 「utils」 辅助工具类
```

以下会按照如下顺序一一实现：
- 消息通信协议设计与实现
- 服务端频道 -> ServerChannel
- 频道服务端 -> ChannelServer


#### 消息通信协议设计与实现

在上述图中，我们有描述到一个「客户端」和「服务端」会建立一个「连接」，并有一个「频道服务端」。在「客户端」中，如何去访问「频道服务端」呢？这里就需要定义一下访问协议：

我们规定：
- 「客户端」初始化的时候会发送：ipc:hello 频道消息，和「服务端」建立连接。
```ts
  // 类似于这样的含义, 不是实现代码，只是示意
  class IPCClient {
    constructor() {
      ipcRenderer.send('ipc:hello');
    }
  }
```
- 「客户端」和服务端的消息传递，统一在 ipc:message 频道进行消息接收和发送，即：
```
  xxx.webContents.send('ipc:message', message);
  ...
  ipcRenderer.send('ipc:message', message);
```
- 当「客户端」被卸载的时候（比如窗口关闭），发送断开连接消息：ipc:disconnect ，进行销毁所有的消息监听。

因此，我们设计如下协议：

[core/common/ipc.electron.ts]
```ts
import { Event } from '../../base/event'; // 工具类
import { VSBuffer } from '../../base/buffer'; // 工具类

export interface IMessagePassingProtocol {
  onMessage: Event<VSBuffer>;
  send(buffer: VSBuffer): void;
}

export interface Sender {
  send(channel: string, msg: Buffer | null): void;
}

export class Protocol implements IMessagePassingProtocol {
  constructor(
    private readonly sender: Sender,
    readonly onMessage: Event<VSBuffer>,
  ) {}

  send(message: VSBuffer): void {
    try {
      this.sender.send('ipc:message', <Buffer>message.buffer);
    } catch (e) {
      // systems are going down
    }
  }

  dispose(): void {
    this.sender.send('ipc:disconnect', null);
  }
}

```

使用示意：

```ts
...
const protocol = new Protocol(webContents, onMessage);
..
const protocol = new Protocol(ipcRenderer, onMessage);
```

#### 定义服务端频道：IServerChannel

「服务端频道」即在「服务端」的「频道服务」中注册的「频道」（服务）。

[core/common/ipc.ts]
```ts
export interface IServerChannel<TContext = string> {
  call<T>(
    ctx: TContext,
    command: string,
    arg?: any,
    cancellationToken?: CancellationToken,
  ): Promise<T>; // 发起服务请求
  listen<T>(ctx: TContext, event: string, arg?: any): Event<T>;// 监听消息
}
```
> 具体实现，是在实际使用的时候才会去定义服务，因此会在后续完成 IPC 机制后，进行使用用例的时候再介绍「服务端频道」如何定义与使用。

#### 定义频道的服务端
前面有讲解到，「客户端」访问服务前，会和「服务端」建立一个「连接」，在「连接」中，存在一个「频道服务端」管理着服可提供给「客户端」访问的「服务频道」。

首先，我们定义一下「服务频道」接口:

[core/common/ipc.ts]
```ts
export interface IChannelServer<TContext = string> {
  registerChannel(channelName: string, channel: IServerChannel<TContext>): void;
}
```
- 主要有一个注册频道的方法

接着，我们实现一个「频道服务」
```ts
export class ChannelServer<TContext = string>
  implements IChannelServer<TContext>, IDisposable {
  // 保存客户端可以访问的频道信息
  private readonly channels = new Map<string, IServerChannel<TContext>>();

  // 消息通信协议监听
  private protocolListener: IDisposable | null;

  // 保存活跃的请求，在收到取消消息后，进行取消执行，释放资源
  private readonly activeRequests = new Map<number, IDisposable>();

  // 在频道服务器注册之前，可能会到来很多请求，此时他们会停留在这个队列里
  // 如果 timeoutDelay 过时后，则会移除
  // 如果频道注册完成，则会从此队列里拿出并执行
  private readonly pendingRequests = new Map<string, PendingRequest[]>();

  constructor(
    private readonly protocol: IMessagePassingProtocol, // 消息协议
    private readonly ctx: TContext, // 服务名
    private readonly timeoutDelay: number = 1000, // 通信超时时间
  ) {
    // 接收 ChannelClient 的消息
    this.protocolListener = this.protocol.onMessage(msg =>
      this.onRawMessage(msg),
    );
    // 当我们频道服务端实例化完成时，我们需要给频道客服端返回实例化完成的消息：
    this.sendResponse({ type: ResponseType.Initialize });
  }

  public dispose(): void { ... }
  public registerChannel(
    channelName: string, channel: IServerChannel<TContext>): void {
  	...
  }
  private onRawMessage(message: VSBuffer): void { ... }
  private disposeActiveRequest(request: IRawRequest): void { ... }
  private flushPendingRequests(channelName: string): void { ... }
  private sendResponse(response: IRawResponse): void { ... }
  private send(header: any, body: any = undefined): void { ... }
  private sendBuffer(message: VSBuffer): void { ... }
  private onPromise(request: IRawPromiseRequest): void { ... }
  private collectPendingRequest(request: IRawPromiseRequest): void   {
    ...
  }

```
我们来解释一个重要的集合：`activeRequests`
```ts
  private readonly activeRequests = new Map<number, IDisposable>();
```
这个 Map 存储着活跃的「服务请求」，即仍然在执行中的请求，如果客户端销毁（比如窗口关闭），则会进行统一的释放，即：dispose

```ts
 public dispose(): void {
    if (this.protocolListener) {
      this.protocolListener.dispose();
      this.protocolListener = null;
    }
    this.activeRequests.forEach(d => d.dispose());
    this.activeRequests.clear();
  }
```

> 释放的时候，除了 activeRequests，也还包括建立了连接的协议监听释放：protocolListener

接着，我们来实现「注册频道」方法

```ts
  registerChannel(
    channelName: string, channel: IServerChannel<TContext>): void {

    // 保存频道
    this.channels.set(channelName, channel);

    // 如果频道还未注册好之前就来了很多请求，则在此时进行请求执行。
    // https://github.com/microsoft/vscode/issues/72531
    setTimeout(() => this.flushPendingRequests(channelName), 0);
  }

  private flushPendingRequests(channelName: string): void {
    const requests = this.pendingRequests.get(channelName);

    if (requests) {
      for (const request of requests) {
        clearTimeout(request.timeoutTimer);

        switch (request.request.type) {
          case RequestType.Promise:
            this.onPromise(request.request);
            break;
          default:
            break;
        }
      }

      this.pendingRequests.delete(channelName);
    }
  }
```

接下来，我们再来实现 `onRawMessage`:

`onRawMessage`用于处理`Buffer`消息。

[core/common/ipc.ts]
```ts
  private onRawMessage(message: VSBuffer): void {
    // 解读 Buffer 消息
    const reader = new BufferReader(message);
    // 解读消息头：
    // [
    // type, 消息类型
    // id, 消息 id
    // channelName, 频道名
    // name 服务方法名
    // ]
    // deserialize 为工具方法，解读 Buffer
    const header = deserialize(reader);
    // 解读消息体，即执行服务方法的参数
    const body = deserialize(reader);
    const type = header[0] as RequestType;

    // 返回执行结果
    switch (type) {
      case RequestType.Promise:
        //
        return this.onPromise({
          type,
          id: header[1],
          channelName: header[2],
          name: header[3],
          arg: body,
        });
      case RequestType.PromiseCancel:
        return this.disposeActiveRequest({ type, id: header[1] });
      default:
        break;
    }
  }
```
其中，`onPromise` 为开始访问具体的服务，执行服务方法，并返回结果给「客户端」:


[core/common/ipc.ts]
```ts
private onPromise(request: IRawPromiseRequest): void {
    const channel = this.channels.get(request.channelName);
    // 如果频道不存在，则放入 PendingRequest，等待频道注册后执行或者过期后清理。
    if (!channel) {
      this.collectPendingRequest(request);
      return;
    }

    // 取消请求 token -> 机制见 可取消的 Promise 部分内容讲解
    const cancellationTokenSource = new CancellationTokenSource();
    let promise: Promise<any>;
    try {
      // 调用频道 call 执行具体服务方法
      promise = channel.call(
        this.ctx,
        request.name,
        request.arg,
        cancellationTokenSource.token,
      );
    } catch (err) {
      promise = Promise.reject(err);
    }

    const { id } = request;

    promise.then(
      data => {
        // 执行完成，返回执行结果
        this.sendResponse(<IRawResponse>{
          id,
          data,
          type: ResponseType.PromiseSuccess,
        });
        // 从活跃的请求中清理该请求
        this.activeRequests.delete(request.id);
      },
      err => {
        // 如果有异常，进行消息的异常处理，并返回响应结果。
        if (err instanceof Error) {
          this.sendResponse(<IRawResponse>{
            id,
            data: {
              message: err.message,
              name: err.name,
              stack: err.stack
                ? err.stack.split
                  ? err.stack.split('\n')
                  : err.stack
                : undefined,
            },
            type: ResponseType.PromiseError,
          });
        } else {
          this.sendResponse(<IRawResponse>{
            id,
            data: err,
            type: ResponseType.PromiseErrorObj,
          });
        }

        this.activeRequests.delete(request.id);
      },
    );
    // 将请求存储到活跃请求，并提供可以释放的令牌。
    const disposable = toDisposable(() => cancellationTokenSource.cancel());
    this.activeRequests.set(request.id, disposable);
  }
```

`sendResponse` 会根据执行结果，返回具体类型的消息；
`send` 则是将消息进行 buffer 序列化
`sendBuffer` 发送消息给「客户端」

[core/common/ipc.ts]

```ts
export enum ResponseType {
  Initialize = 200, // 初始化消息返回
  PromiseSuccess = 201, // promise 成功
  PromiseError = 202, // promise 失败
  PromiseErrorObj = 203,
  EventFire = 204,
}

type IRawInitializeResponse = { type: ResponseType.Initialize };
type IRawPromiseSuccessResponse = {
  type: ResponseType.PromiseSuccess; // 类型
  id: number; // 请求 id
  data: any; // 数据
};
type IRawPromiseErrorResponse = {
  type: ResponseType.PromiseError;
  id: number;
  data: { message: string; name: string; stack: string[] | undefined };
};
type IRawPromiseErrorObjResponse = {
  type: ResponseType.PromiseErrorObj;
  id: number;
  data: any;
};

type IRawResponse =
  | IRawInitializeResponse
  | IRawPromiseSuccessResponse
  | IRawPromiseErrorResponse
  | IRawPromiseErrorObjResponse;

private sendResponse(response: IRawResponse): void {
    switch (response.type) {
      case ResponseType.Initialize:
        return this.send([response.type]);

      case ResponseType.PromiseSuccess:
      case ResponseType.PromiseError:
      case ResponseType.EventFire:
      case ResponseType.PromiseErrorObj:
        return this.send([response.type, response.id], response.data);
      default:
        break;
    }
  }


  private send(header: any, body: any = undefined): void {
    const writer = new BufferWriter();
    serialize(writer, header);
    serialize(writer, body);
    this.sendBuffer(writer.buffer);
  }

  private sendBuffer(message: VSBuffer): void {
    try {
      this.protocol.send(message);
    } catch (err) {
      // noop
    }
  }
```

如果请求被取消了，我们会如下操作：

[core/common/ipc.ts]
```ts
  private disposeActiveRequest(request: IRawRequest): void {
    const disposable = this.activeRequests.get(request.id);

    if (disposable) {
      disposable.dispose();
      this.activeRequests.delete(request.id);
    }
  }
```

#### 定义频道的客户端

「频道客户端」用于像服务发送请求，并接收请求的结果：

首先，我们可以定义个处理返回结果的接口：

```ts
type IHandler = (response: IRawResponse) => void;
```

```ts
export interface IChannelClient {
  getChannel<T extends IChannel>(channelName: string): T;
}
```

```ts
  export class ChannelClient implements IChannelClient, IDisposable {
    private protocolListener: IDisposable | null;

    private state: State = State.Uninitialized; // 频道的状态

    private lastRequestId = 0; // 通信请求唯一 ID 管理

    // 活跃中的 request, 用于取消的时候统一关闭;如果频道被关闭了（dispose），则统一会往所有的频道发送取消消息，从而确保通信的可靠性。
    private readonly activeRequests = new Set<IDisposable>();

    private readonly handlers = new Map<number, IHandler>(); // 通信返回结果后的处理

    private readonly _onDidInitialize = new Emitter<void>();

	// 当频道被初始化时会触发事件
	readonly onDidInitialize = this._onDidInitialize.event;

    constructor(private readonly protocol: IMessagePassingProtocol)    {
      this.protocolListener =
        this.protocol.onMessage(msg => this.onBuffer(msg));
    }
}
```

```ts
enum State {
  Uninitialized, // 未初始化
  Idle, // 就绪
}

private state: State = State.Uninitialized;
```
「频道客户端」的状态，有两种，一个是「未初始化」，或者是「就绪状态」。未初始化就是指「频道服务端」还未准备好之前的状态，准备好之后会触发`_onDidInitialize`事件，更新频道状态。

```ts
    constructor(
      private readonly protocol: IMessagePassingProtocol) {
      this.protocolListener =
        this.protocol.onMessage(msg => this.onBuffer(msg));
    }
```
在「频道客户端」初始化的时候，监听了「频道服务端」的消息，「频道服务端」准备好之后，发送的就绪状态的消息也是通过此消息监听。

`onBuffer` 即解读`Buffer`消息;
`onResponse` 根据解读的消息，进行消息处理，返回到调用的地方。

```ts
    private onBuffer(message: VSBuffer): void {
      const reader = new BufferReader(message);
      const header = deserialize(reader);
      const body = deserialize(reader);
      const type: ResponseType = header[0];

      switch (type) {
        case ResponseType.Initialize:
          return this.onResponse({ type: header[0] });

        case ResponseType.PromiseSuccess:
        case ResponseType.PromiseError:
        case ResponseType.EventFire:
        case ResponseType.PromiseErrorObj:
          return this.onResponse({ type: header[0], id: header[1], data: body });
      }
    }

    private onResponse(response: IRawResponse): void {

      // 「频道服务端」就绪消息处理
      if (response.type === ResponseType.Initialize) {
        this.state = State.Idle;
        this._onDidInitialize.fire();
        return;
      }

      // 「频道服务端」进行消息处理与返回
      const handler = this.handlers.get(response.id);

      if (handler) {
        handler(response);
      }
    }
```

「频道服务端」发起请求之前，构造一个频道结构，去发送消息。
> 为什么要构造一个频道来发消息，不直接发？留个疑问。

```ts
    getChannel<T extends IChannel>(channelName: string): T {
      const that = this;
      return {
        call(
          command: string, // 服务方法名
          arg?: any, // 参数
          cancellationToken?: CancellationToken) { // 取消
          return that.requestPromise(
            channelName,
            command,
            arg,
            cancellationToken,
          );
        },
        listen(event: string, arg: any) {
          //  TODO
          // return that.requestEvent(channelName, event, arg);
        },
      } as T;
    }
```

`requestPromise`即发起服务调用请求：

```ts
private requestPromise(
    channelName: string,
    name: string,
    arg?: any,
    cancellationToken = CancellationToken.None,
  ): Promise<any> {
    const id = this.lastRequestId++;
    const type = RequestType.Promise;
    const request: IRawRequest = { id, type, channelName, name, arg };

    // 如果请求被取消了，则不再执行。
    if (cancellationToken.isCancellationRequested) {
      return Promise.reject(canceled());
    }

    let disposable: IDisposable;

    const result = new Promise((c, e) => {
      // 如果请求被取消了，则不再执行。
      if (cancellationToken.isCancellationRequested) {
        return e(canceled());
      }

      // 只有频道确认注册完成后，才开始发送请求，否则一直处于队列中
      // 在「频道服务端」准备就绪后，会发送就绪消息回来，此时会触发状态变更为「idle」就绪状态
      // 从而会触发 uninitializedPromise.then
      // 从而消息可以进行发送
      let uninitializedPromise: CancelablePromise<
        void
      > | null = createCancelablePromise(_ => this.whenInitialized());
      uninitializedPromise.then(() => {
        uninitializedPromise = null;

        const handler: IHandler = response => {
          console.log(
            'main process response:',
            JSON.stringify(response, null, 2),
          );
          // 根据返回的结果类型，进行处理, 这里不处理 Initialize 这个会在更上层处理
          switch (response.type) {
            case ResponseType.PromiseSuccess:
              this.handlers.delete(id);
              c(response.data);
              break;

            case ResponseType.PromiseError:
              this.handlers.delete(id);
              const error = new Error(response.data.message);
              (<any>error).stack = response.data.stack;
              error.name = response.data.name;
              e(error);
              break;

            case ResponseType.PromiseErrorObj:
              this.handlers.delete(id);
              e(response.data);
              break;
            default:
              break;
          }
        };

        // 保存此次请求的处理
        this.handlers.set(id, handler);

        // 开始发送请求
        this.sendRequest(request);
      });

      const cancel = () => {
        // 如果还未初始化，则直接取消
        if (uninitializedPromise) {
          uninitializedPromise.cancel();
          uninitializedPromise = null;
        } else {
        // 如果已经初始化，并且在请求中，则发送中断消息
          this.sendRequest({ id, type: RequestType.PromiseCancel });
        }

        e(canceled());
      };

      const cancellationTokenListener = cancellationToken.onCancellationRequested(
        cancel,
      );
      disposable = combinedDisposable(
        toDisposable(cancel),
        cancellationTokenListener,
      );
      // 将请求保存到活跃请求中
      this.activeRequests.add(disposable);
    });
    // 执行完毕后从活跃请求中移除此次请求
    return result.finally(() => this.activeRequests.delete(disposable));
  }
```

发送消息的方法，同接收消息一致，此处不在累赘:
```ts
private sendRequest(request: IRawRequest): void {
  switch (request.type) {
    case RequestType.Promise:
    return this.send(
      [request.type, request.id, request.channelName, request.name],
      request.arg,
    );

  case RequestType.PromiseCancel:
    return this.send([request.type, request.id]);
    default:
      break;
  }
}

private send(header: any, body: any = undefined): void {
  const writer = new BufferWriter();
  serialize(writer, header);
  serialize(writer, body);
  this.sendBuffer(writer.buffer);
}

private sendBuffer(message: VSBuffer): void {
  try {
    this.protocol.send(message);
  } catch (err) {
    // noop
  }
}
```



