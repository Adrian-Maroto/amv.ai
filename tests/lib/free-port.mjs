/* A port the kernel says is free, for a server a suite starts itself.
   The Postgres suites used to pick 41000 + a random number below 8000, and
   under a parallel run that collided often enough to fail CI with "pg_ctl:
   could not start server" on a change that touched no database code. Asking
   the kernel is what serveApp and serveArtifact already do. */
import { createServer } from 'node:net';
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
