import { AbortError } from "./abort-error.js";
import type { Duplex, Source, Sink } from "it-stream-types";

export interface Options<T> {
  onReturnError?: (err: Error) => void;
  onAbort?: (source: Source<T>) => void | Promise<void>;
  abortMessage?: string;
  abortCode?: string;
  returnOnAbort?: boolean;
}

// Wrap an iterator to make it abortable, allow cleanup when aborted via onAbort
export function abortableSource<T>(
  source: Source<T>,
  signal: AbortSignal,
  options?: Options<T>
): AsyncIterable<T> {
  if ((source as Iterable<T>)[Symbol.iterator]) {
    return abortableSourceSync((source as Iterable<T>)[Symbol.iterator](), signal, options);
  } else {
    return abortableSourceAsync((source as AsyncIterable<T>)[Symbol.asyncIterator](), signal, options);
  }
}

function abortableSourceSync<T>(
  iterator: Iterator<T>,
  signal: AbortSignal,
  options?: Options<T>
) {
  const opts: Options<T> = options ?? {};

  let done = false;
  let resolve: (result: IteratorResult<T>) => void;
  let reject: (err: any) => void;

  const { abortMessage, abortCode } = opts;

  const maybeReturn = () => {
    if (iterator.return) {
      try {
        iterator.return()
      } catch (err: any) {
        if (opts.onReturnError) {
          opts.onReturnError(err)
        }
      }
    }
  };

  const onResolve = (value: IteratorResult<T, any>) => {
    console.log('on resolve')

    if (done) {
      return;
    }


    if (value.done) {
      cleanup();
    }

    setTimeout(resolve, 0, value);
  };

  const onReject = (err: any) => {
    console.log('on reject')
    if (done) {
      // console.log(err)
      return;
    }
    cleanup();

    maybeReturn();
  };

  const onAbort = async () => {
    console.log('on abort')
    if (done) {
      return;
    }
    cleanup();

    if (opts.onAbort) {
      await opts.onAbort({
        [Symbol.iterator]: () => iterator
      });
    }

    if (opts.returnOnAbort) {
      resolve({ done: true, value: undefined });
      return;
    }

    maybeReturn();

    console.log(reject)
    reject && reject(new AbortError(abortMessage, abortCode));
  };

  const cleanup = () => {
    done = true;
    signal.removeEventListener("abort", onAbort);
  };

  const it = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          console.log('iteration')
          if (done) {
            return Promise.resolve({
              done: true,
              value: undefined,
            } as IteratorReturnResult<any>);
          }

          const promise = new Promise<IteratorResult<T, any>>((res, rej) => {
            resolve = res;
            reject = rej;
          });

          if (signal.aborted) {
            onAbort();
          } else {
            try {
              onResolve(iterator.next());
            } catch (err) {
              onReject(err);
            }
          }

          return promise;
        },
        return() {
          // This will be reached if the consumer called 'break' or 'return' early in the loop.
          cleanup();

          maybeReturn();

          return Promise.resolve<IteratorReturnResult<any>>({
            done: true,
            value: undefined,
          });
        },
      };
    },
  };

  signal.addEventListener("abort", onAbort);

  return it;
}

function abortableSourceAsync<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
  options: Options<T> = {}
) {
  let done = false;
  let resolve: (result: IteratorResult<T>) => void;
  let reject: (err: any) => void;

  const { abortMessage, abortCode } = options;

  const maybeReturn = () => {
    if (iterator.return) {
      if (options.onReturnError) {
        // If errHandler given, return error
        iterator.return().catch(options.onReturnError);
      } else {
        iterator.return().catch(() => {});
      }
    }
  };

  const onResolve = (value: IteratorResult<T, void>) => {
    if (done) {
      return;
    }

    if (value.done) {
      cleanup();
    }

    setTimeout(resolve, 0, value);
  };

  const onReject = (err: any) => {
    if (done) {
      // console.log(err)
      return;
    }
    cleanup();

    maybeReturn();
  };

  const onAbort = async () => {
    if (done) {
      return;
    }
    cleanup();

    if (options.onAbort) {
      await options.onAbort({
        [Symbol.asyncIterator]: () => iterator
      });
    }

    if (options.returnOnAbort) {
      resolve({ done: true, value: undefined });
      return;
    }

    maybeReturn();

    reject && reject(new AbortError(abortMessage, abortCode));
  };

  const cleanup = () => {
    done = true;
    signal.removeEventListener("abort", onAbort);
  };

  const it = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (done) {
            return Promise.resolve({
              done: true
            } as IteratorReturnResult<T>);
          }

          const promise = new Promise<IteratorResult<T, any>>((res, rej) => {
            resolve = res;
            reject = rej;
          });

          if (signal.aborted) {
            onAbort();
          } else {
            iterator.next().then(onResolve, onReject);
          }

          return promise;
        },
        return() {
          // This will be reached if the consumer called 'break' or 'return' early in the loop.
          cleanup();

          maybeReturn();

          return Promise.resolve<IteratorReturnResult<any>>({
            done: true,
            value: undefined
          });
        },
      };
    },
  };

  signal.addEventListener("abort", onAbort);

  return it;
}

export function abortableSink<T, R>(
  sink: Sink<T, R>,
  signal: AbortSignal,
  options?: Options<T>
): Sink<T, R> {
  return (source: Source<T>) =>
    sink(abortableSource(source, signal, options) as any);
}

export function abortableDuplex<
  TSource,
  TSink = TSource,
  RSink = Promise<void>
>(
  duplex: Duplex<TSource, TSink, RSink>,
  signal: AbortSignal,
  options?: Options<TSource>
) {
  return {
    sink: abortableSink(duplex.sink, signal, {
      ...options,
      onAbort: undefined,
    }),
    source: abortableSource(duplex.source, signal, options),
  };
}

export { AbortError };
export { abortableSink as abortableTransform };
