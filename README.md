## 启动

```bash
git clone git@github.com:spcBackToLife/jupiter-electron-ipc-demo.git
cd jupiter-electron-ipc-demo
yarn install
yarn dev
```

## 简介
此项目是将 vscode 中的 ipc 通信机制完整的实现了一遍，大家可以看如上的启动方式，进行启动和体验。

## 服务使用示例

[创建一个windowSercice]

```ts
export class WindowService {

  doSomething(): string {
    console.log('do something and return done')
    return 'done';
  }
}

```

[创建一个服务的频道]

```ts
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

```

[渲染进程-src/render/index.html]

```ts
<html>
  <div>jupiter electron</div>
  <script>
    const { Client }  = require('../../core/electron-render/IPCClient');
    const mainProcessConnection = new Client(`window_1`);
    const channel = mainProcessConnection.getChannel('windowManager');
    channel.call('doSomething').then((result) => console.log('result:', result));
  </script>
</html>

```

[主进程-src/main.ts]

```ts
import { app, BrowserWindow } from 'electron';
import path from 'path';
import { Server as ElectronIPCServer } from '../core/electron-main/ipc.electron-main';
import { WindowChannel } from './windowServiceIpc';
import { WindowService } from './windowService';

app.on('ready', () => {
  const electronIpcServer = new ElectronIPCServer();
  electronIpcServer.registerChannel('windowManager',  new WindowChannel(new WindowService()))


  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: true
    }
  });

  console.log('render index html:', path.join(__dirname, 'render', 'index.html'));
  win.loadFile(path.join(__dirname, 'render', 'index.html'));
})

```

启动并运行一波：

```ts
"scripts": {
  ...
  "dev": "tsc && electron ./src/main.js",
  ...
},
```

启动：

```ts
  yarn dev
```

![image](https://user-images.githubusercontent.com/20703494/99907036-81ca1600-2d15-11eb-9bf0-e8aa12db3795.png)

至此，我们实现了 vscode 的 ipc 机制，大家可以前往这里进行体验：

[jupiter-electron-ipc-demo](https://github.com/spcBackToLife/jupiter-electron-ipc-demo/)



## 模式介绍
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
![image](https://user-images.githubusercontent.com/20703494/99906970-0ff1cc80-2d15-11eb-8101-7ea62690e7dc.png)


> 服务端可以是「渲染进程」、也可以是「主进程」，取决于谁提供服务给谁。

可以看到，服务端提供 n 个服务供客户端访问。但这样有一个问题，这里，服务端提供的服务，是所有客户端都能访问的，就会有问题，就好比：支付宝为所有用户提供了基础服务，比如：电费、税费、社保查询服务，但有些服务可能只有特定人群能访问，比如：优选100% 赚钱的基金服务。

因此，我们这样的设计就无法满足这个要求，因此我们需要做一个调整：
![image](https://user-images.githubusercontent.com/20703494/99907010-4d565a00-2d15-11eb-8b0e-6bcf17b83c39.png)

我们增加了 频道服务的概念，每个客户端基于频道来访问服务，比如：
- 客户端1 访问了 频道服务1，客服端2 访问 频道服务2
- 频道服务1和2都有通用的服务，也有自己的特权服务。
- 客服端访问服务的时候，会为每个客户，生成一个频道，来给他提供他具有的服务
- 在为客服创建对应的频道服务的时候，会将服务端通用服务注册到频道中，也会根据用户的特点，注册其特有的服务。

通过以上模式，解决了上述问题，但又带来了一些问题：

用户每一次访问服务的时候，都去新建一个频道服务吗？

按照上述逻辑，的确会是这样，因此，为了解决这个问题，我们需要如下设计：

![image](https://user-images.githubusercontent.com/20703494/99907005-44658880-2d15-11eb-9be9-3d87aa715dff.png)


我们在服务端，新加一个概念，叫连接（Connection），客户端初始化的时候，可以发起通信连接，此时就会去新建一个频道服务，并存储在服务端，客户端下一次发起服务访问请求的时候，直接去获取频道服务，去那相应的服务进行执行。

这样的方案，看起来完美了，但还有一个问题，上述方案，我们可以适用如下场景：
- 「渲染进程」期望「主进程」做一件事情，并返回执行结果。
那如果是这样的设计，又如何去满足：
- 「主进程」期望「渲染进程」做一件事情，并返回执行结果。

这好像是「服务端」和「客户端」互换了身份。如何让这两种情况同时存在呢？

我们可以做如下设计：
![image](https://user-images.githubusercontent.com/20703494/99907014-56472b80-2d15-11eb-8425-57de6d12fe39.png)

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
- 频道客户端 -> ChannelClient
- 连接 -> Connection
- 客户端 -> IPCClient
- 服务端 -> IPCServer



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

#### 定义一个连接: Connection
根据上面的设计图所示，如下：
```ts
export interface Client<TContext> {
  readonly ctx: TContext;
}
export interface Connection<TContext> extends Client<TContext> {
  readonly channelServer: ChannelServer<TContext>; // 频道服务端
  readonly channelClient: ChannelClient; // 频道客户端
}
```

#### 定义服务端：IPCServer

```ts
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
    // 释放所有监听
    dispose(): void {
      this.channels.clear();
      this._connections.clear();
      this._onDidChangeConnections.dispose();
    }
 }
```

前面我们有提到「消息通信协议」，即：
- 在 'ipc:message' 频道收发消息
- 发送 'ipc:hello' 频道消息开始建立链接
- 断开连接的时，发送一个消息到 'ipc:disconnect' 频道

可能大家会有疑问，为什么我们的通信消息还需要建立连接，这意味着是长连接吗？

其实不是长连接，还是一次性通信的，其实流程是这样的：
- 一开始渲染进程发送 'ipc:hello'消息，打算后续可能会在 'ipc:message' 进行通信, 请主进程做好准备。
- 主进程接受到 'ipc:hello' 消息，发现是这个渲染进程**第一次**需要 'ipc:message' 频道通信，就开始监听这个频道消息。
- 当渲染进程卸载的时候，发出了 'ipc:disconnect' 消息。
- 主进程接收到渲染进程的 'ipc:disconnect' 消息。 就取消了在 'ipc:message' 的监听。

这里有一个注意点就是，'ipc:hello' 其实是在主进程 IPCServer 实例化的时候就建立的一个监听，用于了解每一个渲染进程需要的通信情况。

因此，这个通信机制的完整流程其实是这样：

TODO

> 这里有个很细节的地方，就是所有的渲染进程和主进程的通信都是通过 'ipc:message' 进行通信，那原本发送给窗口 A 的消息，窗口 B 也会收到？当然不会！，请听后续讲解。
> 上面的图只是简单的演示，当然连接会有重试机制。

接下来，我们开始实现上面的流程。

首先，定义一个客户端连接事件接口：
```ts
export interface ClientConnectionEvent {
  protocol: IMessagePassingProtocol; // 消息通信协议
  onDidClientDisconnect: Event<void>; // 断开连接事件
}

```

接下来，我们实现一个监听客户端连接的方法 `getOnDidClientConnect`

```ts
export class IPCServer<TContext = string>
  implements
    IChannelServer<TContext>,
    IDisposable {
    private static getOnDidClientConnect(): Event<ClientConnectionEvent> {
      const onHello = Event.fromNodeEventEmitter<Electron.WebContents>(
        ipcMain,
        'ipc:hello',
        ({ sender }) => sender,
      );
      ...
    }

    constructor(onDidClientConnect: Event<ClientConnectionEvent>) {
      onDidClientConnect(({ protocol, onDidClientDisconnect }) => {
        ...
      }
    }
}
```

通过流程图，我们知道在 IPCServer 实例化的时候，我们会注册 'ipc:hello' 消息监听， 我们可以把收到此消息作为建立连接的标志。

> 如果我发送多个 onHello 消息，就连接了多次？当然不是，请听下面分析。

首先简单解释下这句话，更详细的解析会在后续的 vscode 事件机制中进行解读：

```ts
const onHello = Event.fromNodeEventEmitter<Electron.WebContents>(
    ipcMain,
    'ipc:hello',
    ({ sender }) => sender,
);
```

这个的含义，其实就是定义了一个 ipc:hello 的监听，比如原来，你注册监听 ipc:hello 可能是这样：

```ts
const handler = (e) => {
  console.log('sender:',  e.sender.id);
};
ipcMain.on('ipc:hello', handler)

// 移除监听
ipcMain.removeListener('ipc:hello', handler);
```

而现在是这样的:
```ts
const onHello = Event.fromNodeEventEmitter<Electron.WebContents>(
    ipcMain,
    'ipc:hello',
    ({ sender }) => sender,
);
const listener = onHello((sender) => {
  console.log('sender');
});

// 移除监听
listener.dispose();
```
这样的写法有着诸多的好处，以及说 Event.fromNodeEventEmitter 是怎样的实现，会在后续持续更新。

接下来，我们来继续实现 `getOnDidClientConnect()`

```ts
export class IPCServer<TContext = string>
  implements
    IChannelServer<TContext>,
    IDisposable {
    private static getOnDidClientConnect(): Event<ClientConnectionEvent> {
      const onHello = Event.fromNodeEventEmitter<Electron.WebContents>(
        ipcMain,
        'ipc:hello',
        ({ sender }) => sender,
      );
      return Event.map(onHello, webContents => {
        const { id } = webContents;
        ...
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
    ...
}
```
我们前面有讲解到，我们定义了 onHello 之后，去监听事件的时候是这样：

```ts
const listener = onHello((sender) => {
  console.log('sender');
});
```

可以看到，针对所有 ipc:hello 的消息的消息参数都被过滤成了 sender，而不是原先的 e。
而：
```ts
getOnDidClientConnect(): Event<ClientConnectionEvent> {
  return Event.map(onHello, webContents => {
    ...
    return { protocol, onDidClientDisconnect };
  })
}
```
则将 onHello 的参数过滤成了：{ protocol, onDidClientDisconnect }。 相当于在 onHello 事件上再一次使用装饰者模式装饰参数

可能有点蒙，我再横向对比下，经过**两次装饰**后

```ts
// 第一次装饰, 事件参数 e 变成了参数 sender
const onHello = Event.fromNodeEventEmitter<Electron.WebContents>(
  ipcMain,
  'ipc:hello',
  ({ sender }) => sender,
);

// 第二次装饰 事件参数 sender(webContents) 变成了 { protocol, onDidClientDisconnect }
getOnDidClientConnect(): Event<ClientConnectionEvent> {
  return Event.map(onHello, webContents => {
    ...
    return { protocol, onDidClientDisconnect };
  })
}

```

从原来的:
```ts
const handler = (e) => {
  console.log('sender:', e.sender.id);
};
ipcMain.on('ipc:hello', handler)

// 移除监听
ipcMain.removeListener('ipc:hello', handler);
```

就变成了:
```ts

// 仍然是 ipc:hello 事件，只不过从原来的消息参数 e 变成了 {protocol, onDidClientDisconnect}
const onDidClientConnnect = getOnDidClientConnect();
const listener = onDidClientConnnect(({protocol, onDidClientDisconnect}) => {
  ...
});

// 解除监听
listener.dispose();

```

好，接下来我们来分析下 `{ protocol, onDidClientDisconnect }` 这两个参数。

protocol 即我们在上面定义的通信协议，包含了：

- sender 是发送对象的接口，只要满足存在一个方法：send 即可。
- 协议规定：
  - 发送 'ipc:hello' 频道消息开始建立链接
  - 在 'ipc:message' 频道收发消息
  - 断开连接的时，发送一个消息到 'ipc:disconnect' 频道

因此：

```ts
  const onMessage = createScopedOnMessageEvent(id, 'ipc:message') as Event<
    VSBuffer
  >;
  const protocol = new Protocol(webContents, onMessage);
```
- webContents 即为 sender：发送消息的对象。
- onMessage 即为在 ipc:message 频道监听消息的方法

这里的 onMessage 可以简单理解为通过封装后的消息监听，即从原先的：
```ts
ipcMain.on('ipc:message', (e, message) => {
  console.log('message:', message);
})
```
变成了:
```ts
onMessage((message) => {
  console.log('message:', message);
})
```

> - 有个很显著的特征就是事件参数由原来的（e, message）变成了 (message)
> - message被使用 buffer 压缩，这也是通信优化的一部分。
> - 当然除此以外，createScopedOnMessageEvent 还有一个能力，是进行了过滤，前面有提到，所有渲染进程，都通过
`ipc:message` 频道通信，那如何避免发给渲染进程A的消息，渲染进程B也收到了呢，就是在这里过滤的，过滤后，渲染进程A只会收到给A的消息。

`onDidClientDisconnect` 同理，是 'ipc:disconnect' 消息监听，就不做解释了。

接下来，我们来继续解析 IPCServer 如何在实例化的时候注册的 ipc:hello 监听

```ts
class IPCServer<TContext = string>
  implements
    IChannelServer<TContext>,
    IDisposable {
      constructor(onDidClientConnect: Event<ClientConnectionEvent>) {
        onDidClientConnect(({ protocol, onDidClientDisconnect }) => {
          const onFirstMessage = Event.once(protocol.onMessage);
          // 第一次接收消息
          onFirstMessage(msg => {
            const reader = new BufferReader(msg);
            const ctx = deserialize(reader) as TContext; // 后续解释

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
          })
        }
      }
}
```
在第一次接收到 ipc:message 的时候，我们会新建一个连接： connection；并在收到：ipc:disconnect 的时候，删除连接、移除监听。


这里的重点方法是注册频道，正如上面设计图中所示，每个新增的频道，都会在已有的连接中添加改频道：
```ts
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
```

服务端准备好了，我们需要实现客户端的细节：
```ts
export class IPCClient<TContext = string>
  implements IChannelClient, IChannelServer<TContext>, IDisposable {
  private readonly channelClient: ChannelClient;

  private readonly channelServer: ChannelServer<TContext>;

  constructor(protocol: IMessagePassingProtocol, ctx: TContext) {

    const writer = new BufferWriter();
    serialize(writer, ctx);
    // 发送服务注册消息 ctx 即服务名。
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
    // 注册频道
    this.channelServer.registerChannel(channelName, channel);
  }

  dispose(): void {
    this.channelClient.dispose();
    this.channelServer.dispose();
  }
}
```

```ts
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

```
