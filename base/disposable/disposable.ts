import { DisposableStore } from "./disposableStore";
import { IDisposable } from "../interface";
import { markTracked, NoneDispose, trackDisposable } from "../utils";



export function isDisposable<E extends object>(
  thing: E,
): thing is E & IDisposable {
  return (
    typeof (<IDisposable>(<any>thing)).dispose === 'function' &&
    (<IDisposable>(<any>thing)).dispose.length === 0
  );
}

export function toDisposable(fn: () => void): IDisposable {
  const self = trackDisposable({
    dispose: () => {
      markTracked(self);
      fn();
    },
  });
  return self;
}

export function combinedDisposable(...disposables: IDisposable[]): IDisposable {
	disposables.forEach(markTracked);
	return trackDisposable({ dispose: () => dispose(disposables) });
}


// dispose 抽象类
export abstract class Disposable implements IDisposable {
  static None = NoneDispose; // 判断是否为空的 dispose 对象

  private readonly _store = new DisposableStore(); // 存储可释放对象
  public dispose(): void {
    markTracked(this);
    this._store.dispose();
  }

  protected _register<T extends IDisposable>(t: T): T {
    if (((t as any) as Disposable) === this) {
      throw new Error('Cannot register a disposable on itself!');
    }
    return this._store.add(t);
  }
}


export function dispose<T extends IDisposable>(disposable: T): T;
export function dispose<T extends IDisposable>(
  disposable: T | undefined,
): T | undefined;
export function dispose<T extends IDisposable>(disposables: T[]): T[];
export function dispose<T extends IDisposable>(
  disposables: readonly T[],
): readonly T[];
export function dispose<T extends IDisposable>(
  disposables: T | T[] | undefined,
): T | T[] | undefined {
  if (Array.isArray(disposables)) {
    disposables.forEach(d => {
      if (d) {
        markTracked(d);
        d.dispose();
      }
    });
    return [];
  } else if (disposables) {
    markTracked(disposables);
    disposables.dispose();
    return disposables;
  } else {
    return undefined;
  }
}
