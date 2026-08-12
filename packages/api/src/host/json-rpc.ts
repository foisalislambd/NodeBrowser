import type { NodeBrowser } from './node-browser.js';

export type AgentRpcRequest = {
  jsonrpc?: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
};

export type AgentRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

function asRecord(p: unknown): Record<string, unknown> {
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}

/** JSON-RPC 2.0 over the same host ABI (Phase 36). No extra guest Node. */
export async function handleAgentRpc(bn: NodeBrowser, req: AgentRpcRequest): Promise<AgentRpcResponse> {
  const id = req.id ?? null;
  try {
    const p = asRecord(req.params);
    const method = String(req.method || '');
    let result: unknown;
    switch (method) {
      case 'fs.readFile':
        result = await bn.fs.readFile(String(p.path), 'utf8');
        break;
      case 'fs.writeFile':
        await bn.fs.writeFile(String(p.path), String(p.contents ?? ''));
        result = true;
        break;
      case 'fs.readdir':
        result = await bn.fs.readdir(String(p.path ?? '/'));
        break;
      case 'fs.mkdir':
        await bn.fs.mkdir(String(p.path), { recursive: true });
        result = true;
        break;
      case 'spawn': {
        const proc = await bn.spawn(String(p.cmd), Array.isArray(p.args) ? (p.args as string[]) : [], {
          cwd: typeof p.cwd === 'string' ? p.cwd : '/',
        });
        result = { pid: proc.pid };
        break;
      }
      case 'install':
        await bn.install(Array.isArray(p.packages) ? (p.packages as string[]) : [], String(p.cwd ?? '/'));
        result = true;
        break;
      case 'ports':
        result = bn.ports();
        break;
      case 'killTree':
        result = bn.killTree(Number(p.pid));
        break;
      case 'runtime':
        result = bn.runtime;
        break;
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method ${method}` } };
    }
    return { jsonrpc: '2.0', id, result };
  } catch (e) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: e instanceof Error ? e.message : String(e) },
    };
  }
}
