/**
 * Orchestrator Tower - Node.js Sidecar
 *
 * This is the entry point for the Node.js sidecar process.
 * It will be spawned by the Tauri application to manage CLI subprocesses.
 */

console.log('[Sidecar] Orchestrator Tower Sidecar starting...');
console.log(`[Sidecar] Node.js version: ${process.version}`);
console.log(`[Sidecar] PID: ${process.pid}`);

// Keep the process alive
process.stdin.resume();

process.on('SIGTERM', () => {
  console.log('[Sidecar] Received SIGTERM, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Sidecar] Received SIGINT, shutting down...');
  process.exit(0);
});

console.log('[Sidecar] Ready and waiting for commands...');
