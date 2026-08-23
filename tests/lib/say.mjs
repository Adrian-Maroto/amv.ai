/* WRITING SOMETHING AND THEN EXITING IS NOT THE SAME AS PRINTING IT.

   Node's stdout is asynchronous when it is a PIPE. `console.log` queues the
   write and returns; `process.exit` terminates without waiting for the queue.
   To a terminal this never shows, because stdout to a TTY is synchronous. To a
   pipe it drops the tail, more often the busier the machine is.

   Everything here is read through a pipe by something else. `check.mjs` runs
   the suite with its output captured, the runner spawns each suite into that
   same pipe, and the guard that checks the selection shells out and reads it.
   So the last thing printed before an exit - which is always the verdict - is
   exactly the thing most likely to be lost.

   It has happened twice and cost real time both times: a failing gate whose
   reason vanished, and a listing cut from 307 names to 177 that read as the
   runner silently skipping half the suite. One definition now, so the third
   place cannot get it wrong.

   EAGAIN means the pipe is full and the reader has not caught up; EINTR means
   a signal arrived mid-write. Neither is a failure, and both are retried. */
import { writeSync } from 'fs';

export function say(text, fd = 1) {
  const buf = Buffer.from(String(text), 'utf8');
  let off = 0;
  while (off < buf.length) {
    try { off += writeSync(fd, buf, off, buf.length - off); }
    catch (err) {
      if (err && (err.code === 'EAGAIN' || err.code === 'EINTR')) continue;
      return false;                   // nothing left to do but stop trying
    }
  }
  return true;
}

/* The common case: a line. */
export const sayLine = (text, fd = 1) => say(String(text) + '\n', fd);
