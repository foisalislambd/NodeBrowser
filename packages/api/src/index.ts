/**
 * Public host API. Implementation lives under src/host, src/kernel, src/fs, …
 * Guest Node is C++/WASM — not this package.
 */
export {
  NodeBrowser,
  BrowserNode,
  WebContainer,
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
export type {
  FileSystemTree,
  FileNode,
  SpawnOptions,
  BrowserNodeProcess,
  BrowserNodeEventMap,
  BundleOptions,
  PreviewResult,
  ProjectKind,
  UseWasmOption,
  AgentRpcRequest,
  AgentRpcResponse,
} from './host/node-browser.js';
