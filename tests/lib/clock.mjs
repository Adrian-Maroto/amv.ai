/* A FROZEN CLOCK, FOR TESTS THAT COUNT INTO A WALL-CLOCK WINDOW.

   The limiter counts into `act:<key>:<Math.floor(Date.now()/60000)>` - a
   minute bucket, which is the right shape for a burst control and the wrong
   shape to test against a moving clock. A loop that fires ninety requests only
   runs into the ceiling if all ninety land in ONE bucket. On a quiet machine
   they take milliseconds and always do; under the gate, with four suites
   sharing a box, the loop can straddle a boundary - the count restarts half
   way through, neither half reaches the limit, and the assertion reports that
   the product has no ceiling when the truth is that the minute ticked over.

   That has now happened three times in this repository, each time costing a
   red gate and an investigation into a product defect that did not exist.

   So the window is pinned rather than hoped for. The test then measures the
   property it names - N requests from one caller hit a ceiling - instead of
   also measuring whether the machine was fast enough to finish inside a
   minute.

   NOT for a test that needs time to MOVE: anything asserting that a limit
   resets, a hold matures, or a guard expires must let the clock run, and
   freezing it there would break the thing under test. This is only for the
   inside of a burst. */
export async function withFrozenClock(fn) {
  const real = Date.now;
  const at = real.call(Date);
  try {
    Date.now = () => at;
    return await fn(at);
  } finally {
    /* Restored in a finally so a failing assertion inside the burst cannot
       leave a stopped clock behind for the rest of the file. */
    Date.now = real;
  }
}
