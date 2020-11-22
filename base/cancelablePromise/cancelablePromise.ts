import * as errors from '../errors';
import { Emitter, Event } from '../event';
import { IDisposable } from '../interface';

export function isThenable<T>(obj: any): obj is Promise<T> {
  return obj && typeof (obj as Promise<any>).then === 'function';
}

export interface CancelablePromise<T> extends Promise<T> {
  cancel(): void;
}

export interface CancellationToken {
  readonly isCancellationRequested: boolean; // 被要求取消
  /**
   * An event emitted when cancellation is requested
   *
   * @event
   */
  readonly onCancellationRequested: Event<any>;
}

// 快速的事件
const shortcutEvent = Object.freeze(function (callback, context?): IDisposable {
  const handle = setTimeout(callback.bind(context), 0);
  return {
    dispose() {
      clearTimeout(handle);
    },
  };
} as Event<any>);


class MutableToken implements CancellationToken {
  private _isCancelled: boolean = false;

  private _emitter: Emitter<any> | null = null;

  public cancel() {
    if (!this._isCancelled) {
      this._isCancelled = true;
      if (this._emitter) {
        this._emitter.fire(undefined);
        this.dispose();
      }
    }
  }

  get isCancellationRequested(): boolean {
    return this._isCancelled;
  }

  get onCancellationRequested(): Event<any> {
    if (this._isCancelled) {
      return shortcutEvent;
    }
    if (!this._emitter) {
      this._emitter = new Emitter<any>();
    }
    return this._emitter.event;
  }

  public dispose(): void {
    if (this._emitter) {
      this._emitter.dispose();
      this._emitter = null;
    }
  }
}


export namespace CancellationToken {
  export function isCancellationToken(thing: any): thing is CancellationToken {
    if (thing === None || thing === Cancelled) {
      return true;
    }
    if (thing instanceof MutableToken) {
      return true;
    }
    if (!thing || typeof thing !== 'object') {
      return false;
    }
    return (
      typeof (thing as CancellationToken).isCancellationRequested ===
        'boolean' &&
      typeof (thing as CancellationToken).onCancellationRequested === 'function'
    );
  }

  export const None: CancellationToken = Object.freeze({
    isCancellationRequested: false,
    onCancellationRequested: Event.None,
  });

  export const Cancelled: CancellationToken = Object.freeze({
    isCancellationRequested: true,
    onCancellationRequested: shortcutEvent,
  });
}

function createCancelablePromise<T>(
  callback: (token: CancellationToken) => Promise<T>,
): CancelablePromise<T> {
  // 生成一个取消令牌
  const source = new CancellationTokenSource();

  // 将令牌给到 callback 中， 这样即可控制在 callback 任何生命周期进行终止
  // callback 中也可以主动发起终止。
  const thenable = callback(source.token);
  const promise = new Promise<T>((resolve, reject) => {

    // 被终止了，则会结束此 promise
    source.token.onCancellationRequested(() => {
      reject(errors.canceled());
    });

    // 正常执行，则返回执行结果。
    Promise.resolve(thenable).then(
      value => {
        source.dispose();
        resolve(value);
      },
      err => {
        source.dispose();
        reject(err);
      },
    );
  });

  // 最终返回 Promise 对象
  // @ts-ignore
  return new (class implements CancelablePromise<T> {
    cancel() {
      source.cancel();
    }

    then<TResult1 = T, TResult2 = never>(
      resolve?: ((value: T) => TResult1 | Promise<TResult1>) | undefined | null,
      reject?:
        | ((reason: any) => TResult2 | Promise<TResult2>)
        | undefined
        | null,
    ): Promise<TResult1 | TResult2> {
      return promise.then(resolve, reject);
    }

    catch<TResult = never>(
      reject?: ((reason: any) => TResult | Promise<TResult>) | undefined | null,
    ): Promise<T | TResult> {
      return this.then(undefined, reject);
    }

    finally(onfinally?: (() => void) | undefined | null): Promise<T> {
      return promise.finally(onfinally);
    }
  })();
}

export class CancellationTokenSource {
  private _token?: CancellationToken = undefined;

  private readonly _parentListener?: IDisposable = undefined;

  constructor(parent?: CancellationToken) {
    this._parentListener =
      parent && parent.onCancellationRequested(this.cancel, this);
  }

  get token(): CancellationToken {
    if (!this._token) {
      // be lazy and create the token only when
      // actually needed
      this._token = new MutableToken();
    }
    return this._token;
  }

  cancel(): void {
    if (!this._token) {
      // save an object by returning the default
      // cancelled token when cancellation happens
      // before someone asks for the token
      this._token = CancellationToken.Cancelled;
    } else if (this._token instanceof MutableToken) {
      // actually cancel
      this._token.cancel();
    }
  }

  dispose(): void {
    if (this._parentListener) {
      this._parentListener.dispose();
    }
    if (!this._token) {
      // ensure to initialize with an empty token if we had none
      this._token = CancellationToken.None;
    } else if (this._token instanceof MutableToken) {
      // actually dispose
      this._token.dispose();
    }
  }
}


export {
  createCancelablePromise
}
