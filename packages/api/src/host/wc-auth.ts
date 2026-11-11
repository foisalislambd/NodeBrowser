/**
 * Public names from the WebContainer auth surface.
 * NodeBrowser does not contact StackBlitz. Keys stay in memory and are never sent.
 */

export type AuthFailedError = {
  status: 'auth-failed';
  error: string;
  description: string;
};

export type AuthInitOptions = {
  /** Ignored. NodeBrowser does not redirect to an editor origin. */
  editorOrigin?: string;
  clientId: string;
  scope: string;
};

type LogoutListener = () => void;
type FailedListener = (reason: { error: string; description: string }) => void;

let apiKey: string | null = null;
const loggedOut = new Set<LogoutListener>();
const authFailed = new Set<FailedListener>();

/** Remember a key locally. It is not transmitted. */
export function configureAPIKey(key: string): void {
  apiKey = String(key);
}

/** True when {@link configureAPIKey} was called. The key itself is not readable. */
export function hasConfiguredAPIKey(): boolean {
  return apiKey != null && apiKey.length > 0;
}

export const auth = {
  /**
   * WebContainers gates private npm on StackBlitz OAuth.
   * NodeBrowser uses the registry allowlist and `.npmrc` instead, so init
   * reports `authorized` and does not open a network request.
   */
  init(_options: AuthInitOptions): { status: 'need-auth' | 'authorized' } | AuthFailedError {
    return { status: 'authorized' };
  },

  /** Does not navigate or open a popup. */
  startAuthFlow(_options?: { popup?: boolean }): void {
    /* no StackBlitz OAuth */
  },

  loggedIn(): Promise<void> {
    return Promise.resolve();
  },

  async logout(_options?: { ignoreRevokeError?: boolean }): Promise<void> {
    apiKey = null;
    for (const listener of loggedOut) listener();
  },

  on(event: 'logged-out' | 'auth-failed', listener: LogoutListener | FailedListener): () => void {
    if (event === 'logged-out') {
      const fn = listener as LogoutListener;
      loggedOut.add(fn);
      return () => loggedOut.delete(fn);
    }
    const fn = listener as FailedListener;
    authFailed.add(fn);
    return () => authFailed.delete(fn);
  },
};
