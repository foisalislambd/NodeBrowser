/**
 * Host-side guest engine.
 *
 * The C++/WASM kernel always owns the filesystem, process ids, and pipes.
 * QuickJS runs inside that kernel, so it does not implement this interface:
 * `spawn` of `node` is a kernel process.
 *
 * `v8` runs the same guest bootstrap on the host JavaScript engine (Node's
 * V8, or the browser's). Same-thread WASM calls the engine directly. A Worker
 * kernel runs the guest on its own thread and serves filesystem calls from
 * that thread through a SharedArrayBuffer.
 */
import { sabStdioAvailable } from '../io/sab-stdio.js';
import type { KernelHandle, KernelModule } from './load.js';
import { runGuestOnV8Worker } from './v8-guest-host.js';
import { kernelCallsAreSync, nodeArgsFromSpawn, runNodeOnV8, type V8RunResult } from './v8-guest.js';
import { runShellOnV8, shellScriptFromSpawn } from './v8-shell.js';

export interface GuestProgram {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface HostGuestEngine {
  readonly name: 'v8';
  /**
   * Run the program on the host engine, or return null so the caller keeps
   * the kernel (QuickJS) process. A Worker kernel returns a Promise: the
   * guest runs on another thread and talks to the filesystem through a
   * shared buffer.
   */
  tryRun(program: GuestProgram): V8RunResult | null | Promise<V8RunResult | null>;
}

function canHostOnV8(program: GuestProgram): boolean {
  if (nodeArgsFromSpawn(program.command, program.args)) return true;
  return shellScriptFromSpawn(program.command, program.args) != null;
}

function runSync(mod: KernelModule, handle: KernelHandle, program: GuestProgram): V8RunResult | null {
  const nodeArgs = nodeArgsFromSpawn(program.command, program.args);
  if (nodeArgs) return runNodeOnV8(mod, handle, nodeArgs, program.cwd, program.env);
  const script = shellScriptFromSpawn(program.command, program.args);
  if (script == null) return null;
  return runShellOnV8(mod, handle, script, program.cwd, program.env);
}

export function createHostGuestEngine(
  name: 'quickjs' | 'v8',
  mod: KernelModule,
  handle: KernelHandle,
): HostGuestEngine | null {
  if (name !== 'v8') return null;
  if (kernelCallsAreSync(mod, handle)) {
    return {
      name: 'v8',
      tryRun(program) {
        return runSync(mod, handle, program);
      },
    };
  }
  if (!sabStdioAvailable()) return null;
  return {
    name: 'v8',
    tryRun(program) {
      if (!canHostOnV8(program)) return null;
      return runGuestOnV8Worker(mod, handle, program);
    },
  };
}
