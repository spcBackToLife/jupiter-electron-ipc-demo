import { IDisposable } from "./interface";


export let _globalLeakWarningThreshold = -1; // 泄漏监控提示门槛
export function setGlobalLeakWarningThreshold(n: number): IDisposable {
  const oldValue = _globalLeakWarningThreshold;
  _globalLeakWarningThreshold = n;
  return {
    dispose() {
      _globalLeakWarningThreshold = oldValue;
    },
  };
}


export class LeakageMonitor {
  private _stacks: Map<string, number> | undefined;

  private _warnCountdown = 0;

  constructor(
    readonly customThreshold?: number, // 自定义泄漏门槛提示
    readonly name: string = Math.random().toString(18).slice(2, 5),
  ) {}

  dispose(): void {
    if (this._stacks) {
      this._stacks.clear();
    }
  }

  check(listenerCount: number): undefined | (() => void) {
    let threshold = _globalLeakWarningThreshold;
    if (typeof this.customThreshold === 'number') {
      threshold = this.customThreshold;
    }

    if (threshold <= 0 || listenerCount < threshold) {
      return undefined;
    }

    if (!this._stacks) {
      this._stacks = new Map();
    }
    const stack = new Error().stack!.split('\n').slice(3).join('\n');
    const count = this._stacks.get(stack) || 0;
    this._stacks.set(stack, count + 1);
    this._warnCountdown -= 1;

    if (this._warnCountdown <= 0) {
      // only warn on first exceed and then every time the limit
      // is exceeded by 50% again
      this._warnCountdown = threshold * 0.5;

      // find most frequent listener and print warning
      let topStack: string;
      let topCount = 0;
      this._stacks.forEach((count, stack) => {
        if (!topStack || topCount < count) {
          topStack = stack;
          topCount = count;
        }
      });

      console.warn(
        `[${this.name}] potential listener LEAK detected, having ${listenerCount} listeners already. MOST frequent listener (${topCount}):`,
      );
      console.warn(topStack!);
    }

    return () => {
      const count = this._stacks!.get(stack) || 0;
      this._stacks!.set(stack, count - 1);
    };
  }
}
