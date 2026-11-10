/** Build information injected by vite.config.ts (`define`). */
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_DATE__: string;

/** File Handling API (installed desktop apps opened with a file); feature-detected. */
interface LaunchParams {
  readonly files?: readonly FileSystemFileHandle[];
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void | Promise<void>): void;
}
