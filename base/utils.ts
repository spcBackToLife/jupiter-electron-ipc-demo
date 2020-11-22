
import { IDisposable } from "./interface";

// 是否追踪 disposables
const TRACK_DISPOSABLES = false;

const __is_disposable_tracked__ = '__is_disposable_tracked__';

export const NoneDispose = Object.freeze<IDisposable>({ dispose() {} });

// 标记该对象为可追踪 disposable 对象
export function markTracked<T extends IDisposable>(x: T): void {
  if (!TRACK_DISPOSABLES) {
    return;
  }

  if (x && x !== NoneDispose) {
    try {
      (x as any)[__is_disposable_tracked__] = true;
    } catch {
      // noop
    }
  }
}


export function trackDisposable<T extends IDisposable>(x: T): T {
	if (!TRACK_DISPOSABLES) {
		return x;
	}

	const stack = new Error('Potentially leaked disposable').stack!;
	setTimeout(() => {
		if (!(x as any)[__is_disposable_tracked__]) {
			console.log(stack);
		}
	}, 3000);
	return x;
}
