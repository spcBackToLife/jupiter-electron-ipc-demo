import { IDisposable } from "../interface";
import { markTracked } from "../utils";

export class DisposableStore implements IDisposable {
  // 存储需要 dispose 的对象
  private readonly _toDispose: Set<IDisposable> = new Set<IDisposable>();

  // 是否已经全部 disaposed （释放） 完成
  private _isDisposed: boolean = false;

  // 释放所有 并标记为可追踪
  public dispose(): void {
    if (this._isDisposed) {
      return;
    }

    markTracked(this);
    this._isDisposed = true;
    this.clear();
  }

  // 释放所有 disposes 但并不标记为可追踪
  public clear(): void {
    this._toDispose.forEach(item => item.dispose());
    this._toDispose.clear();
  }


  public add<T extends IDisposable>(t: T): T {
    if (!t) {
      return t;
    }
    if (((t as any) as DisposableStore) === this) {
      throw new Error('Cannot register a disposable on itself!');
    }

    markTracked(t);
    if (this._isDisposed) {
      console.warn(
        new Error(
          'Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!',
        ).stack,
      );
    } else {
      this._toDispose.add(t);
    }

    return t;
  }


}
