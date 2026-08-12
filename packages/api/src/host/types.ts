/** File tree format compatible with WebContainer-style mounts */
export type FileNode =
  | { file: { contents: string | Uint8Array } }
  | { directory: FileSystemTree };

export type FileSystemTree = Record<string, FileNode>;

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export interface BrowserNodeProcess {
  readonly pid: number;
  readonly exit: Promise<number>;
  readonly output: ReadableStream<string>;
  kill(): void;
  write(data: string): void;
}

export type InstallProgressEvent = {
  phase: 'resolve' | 'fetch' | 'extract' | 'bin' | 'lifecycle' | 'done';
  name: string;
  version?: string;
  message?: string;
};

export type FsChangeEvent = { type: string; path: string };

export type BrowserNodeEventMap = {
  'server-ready': [port: number, url: string];
  'install-progress': [progress: InstallProgressEvent];
  'fs-change': [event: FsChangeEvent];
  error: [error: Error];
};
