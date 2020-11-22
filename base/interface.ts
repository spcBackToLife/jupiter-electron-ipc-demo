// only have a dispose way to release all listeners
export interface IDisposable {
  dispose(): void;
}


export interface IdleDeadline {
  readonly didTimeout: boolean;
  timeRemaining(): DOMHighResTimeStamp;
}
