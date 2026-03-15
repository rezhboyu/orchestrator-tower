/**
 * ProcessGuard - Handles process hang protection after result
 *
 * Per spec: 2s wait -> SIGTERM -> 3s wait -> SIGKILL
 * CRITICAL: Use exited flag, NOT proc.exitCode (race condition)
 */

import type { ChildProcess } from 'node:child_process';

export interface ProcessGuardOptions {
  /** Time to wait before SIGTERM (ms), default 2000 */
  gracePeriod?: number;
  /** Time to wait after SIGTERM before SIGKILL (ms), default 3000 */
  killTimeout?: number;
}

const DEFAULT_OPTIONS: Required<ProcessGuardOptions> = {
  gracePeriod: 2000,
  killTimeout: 3000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exited flag reference type.
 * The value property is set synchronously in the exit event handler.
 */
export interface ExitedFlag {
  value: boolean;
}

/**
 * Create exited flag and attach exit handler.
 *
 * @param proc - Child process to monitor
 * @returns Object with value property for tracking exit state
 */
export function createExitedFlag(proc: ChildProcess): ExitedFlag {
  const exited: ExitedFlag = { value: false };
  proc.on('exit', () => {
    exited.value = true;
  });
  return exited;
}

/**
 * Handle process end with timeout protection.
 *
 * This function should be called after receiving a 'result' event.
 * It waits for the process to exit naturally, then sends SIGTERM,
 * and finally SIGKILL if the process still doesn't exit.
 *
 * @param proc - Child process to guard
 * @param exited - Reference to exited flag (set by 'exit' event handler)
 * @param options - Timing options
 */
export async function handleProcessEnd(
  proc: ChildProcess,
  exited: ExitedFlag,
  options: ProcessGuardOptions = {}
): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Wait grace period
  await sleep(opts.gracePeriod);
  if (exited.value) return;

  // Send SIGTERM
  console.log('[ProcessGuard] Process did not exit, sending SIGTERM');
  proc.kill('SIGTERM');

  // Wait for kill timeout
  await sleep(opts.killTimeout);
  if (exited.value) return;

  // Send SIGKILL
  console.log('[ProcessGuard] Process still running, sending SIGKILL');
  proc.kill('SIGKILL');
}
