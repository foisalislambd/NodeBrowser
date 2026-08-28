/** Virtual HTTP server registry — Service Worker talks to this via the page. */

export type HttpMethod = string;

export interface IncomingHttpRequest {
  id: string;
  port: number;
  method: HttpMethod;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface OutgoingHttpResponse {
  id: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

type Handler = (
  req: { method: string; url: string; headers: Record<string, string>; body?: string },
  res: {
    statusCode: number;
    headers: Record<string, string>;
    writeHead: (code: number, headers?: Record<string, string>) => void;
    setHeader: (k: string, v: string) => void;
    write: (chunk: string) => void;
    end: (chunk?: string) => void;
  },
) => void;

export class HttpBridge {
  #servers = new Map<number, Handler>();

  listen(port: number, handler: Handler): void {
    this.#servers.set(port | 0, handler);
  }

  close(port: number): void {
    this.#servers.delete(port | 0);
  }

  has(port: number): boolean {
    return this.#servers.has(port | 0);
  }

  ports(): number[] {
    return [...this.#servers.keys()];
  }

  #access: { port: number; method: string; path: string; status: number }[] = [];
  #onAccess: ((e: { port: number; method: string; path: string; status: number }) => void) | null = null;

  setAccessListener(fn: ((e: { port: number; method: string; path: string; status: number }) => void) | null): void {
    this.#onAccess = fn;
  }

  accessLog(): { port: number; method: string; path: string; status: number }[] {
    return this.#access.slice(-200);
  }

  #noteAccess(port: number, method: string, path: string, status: number): void {
    const e = { port, method, path, status };
    this.#access.push(e);
    if (this.#access.length > 200) this.#access.shift();
    this.#onAccess?.(e);
  }

  /** Invoke registered Node-style handler; returns a Response payload. */
  async dispatch(req: IncomingHttpRequest): Promise<OutgoingHttpResponse> {
    const handler = this.#servers.get(req.port | 0);
    if (!handler) {
      this.#noteAccess(req.port | 0, req.method || 'GET', req.path || '/', 502);
      return {
        id: req.id,
        status: 502,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: `No server listening on port ${req.port}`,
      };
    }

    return new Promise<OutgoingHttpResponse>((resolve) => {
      let status = 200;
      const headers: Record<string, string> = { 'Content-Type': 'text/html; charset=utf-8' };
      let body = '';
      let ended = false;

      const finish = () => {
        if (ended) return;
        ended = true;
        this.#noteAccess(req.port | 0, req.method || 'GET', req.path || '/', status);
        resolve({ id: req.id, status, headers, body });
      };

      const res = {
        statusCode: 200,
        headers,
        writeHead(code: number, h?: Record<string, string>) {
          status = code | 0;
          this.statusCode = status;
          if (h) Object.assign(headers, h);
        },
        setHeader(k: string, v: string) {
          headers[k] = v;
        },
        write(chunk: string) {
          body += String(chunk ?? '');
        },
        end(chunk?: string) {
          if (chunk != null) body += String(chunk);
          finish();
        },
      };

      const nodeReq = {
        method: req.method || 'GET',
        url: req.path || '/',
        headers: req.headers || {},
        body: req.body,
      };

      try {
        const ret = handler(nodeReq, res) as unknown;
        // Support async handlers (e.g. static file from VFS) without racing end()
        if (ret != null && typeof (ret as Promise<void>).then === 'function') {
          (ret as Promise<void>).then(
            () => {
              if (!ended) finish();
            },
            (e) => {
              if (ended) return;
              status = 500;
              body = String(e);
              headers['Content-Type'] = 'text/plain; charset=utf-8';
              finish();
            },
          );
        } else {
          // Sync handler that forgot end() — finish on next macrotask (not microtask)
          // so sync end() always wins; still allows 0-delay async scheduling.
          setTimeout(() => {
            if (!ended) finish();
          }, 0);
        }
      } catch (e) {
        status = 500;
        body = String(e);
        headers['Content-Type'] = 'text/plain; charset=utf-8';
        finish();
      }
    });
  }

  /** Wire window ↔ Service Worker messages. Call once from the demo page. */
  attachServiceWorkerBridge(previewBasePath = '/__bn_preview'): () => void {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return () => undefined;
    }

    const onMessage = async (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== 'bn-http-request') return;
      const out = await this.dispatch({
        id: data.id,
        port: Number(data.port),
        method: data.method || 'GET',
        path: data.path || '/',
        headers: data.headers,
        body: data.body,
      });
      const reply = { type: 'bn-http-response', ...out };
      // Prefer MessageChannel port from SW (reliable). Fall back to source/controller.
      const port = event.ports && event.ports[0];
      if (port) {
        port.postMessage(reply);
        return;
      }
      const src = event.source as MessageEventSource | null;
      if (src && typeof (src as ServiceWorker).postMessage === 'function') {
        (src as ServiceWorker).postMessage(reply);
      } else if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage(reply);
      }
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    void previewBasePath;
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }
}
