import { CancelablePromise, CancellationToken, createCancelablePromise } from "./cancelablePromise";
import * as errors from '../errors';

export function timeout(millis: number): CancelablePromise<void>;
export function timeout(
  millis: number,
  token: CancellationToken,
): Promise<void>;
export function timeout(
  millis: number,
  token?: CancellationToken,
): CancelablePromise<void> | Promise<void> {
  if (!token) {
    return createCancelablePromise(_token => timeout(millis, _token));
  }

  return new Promise((resolve, reject) => {
    const handle = setTimeout(resolve, millis);
    token.onCancellationRequested(() => {
      clearTimeout(handle);
      reject(errors.canceled());
    });
  });
}
