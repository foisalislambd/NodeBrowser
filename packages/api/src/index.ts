/**
 * Public host API. Implementation lives under src/host, src/kernel, src/fs, …
 * Guest Node is C++/WASM — not this package.
 */
export {
  NodeBrowser,
  BrowserNode,
  HttpBridge,
  resetKernelCache,
  sabStdioAvailable,
  SabStdioRing,
  assertAllowedFetchUrl,
  detectProjectKind,
  resolveProjectRoot,
  extractArchive,
  isZip,
  isGzip,
  handleAgentRpc,
} from './host/node-browser.js';
export { WebContainer, configureAPIKey, auth, PreviewMessageType, previewMessageFromData } from './host/webcontainer.js';
export type {
  FileSystemTree,
  FileNode,
  SpawnOptions,
  GuestEngine,
  BrowserNodeProcess,
  BrowserNodeEventMap,
  BundleOptions,
  PreviewResult,
  ProjectKind,
  UseWasmOption,
  AgentRpcRequest,
  AgentRpcResponse,
  SearchHit,
  ProjectInfo,
  ImportRepositoryOptions,
} from './host/node-browser.js';
export type {
  BootOptions,
  WebContainerProcess,
  WebContainerFs,
  DirEnt,
  ExportOptions,
  IFSWatcher,
  PreviewMessage,
  Unsubscribe,
} from './host/webcontainer.js';
