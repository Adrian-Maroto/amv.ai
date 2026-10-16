     read to a caller as "there was nothing there". */
  if(!spec) return json({ error:'unknown_action', message:'AMV does not know that action.' }, 400);

  /* Bounded, because every one of these is an outbound call to somebody else's
     API on somebody else's quota. Writes are bounded harder: reading your
     inbox forty times is a busy morning, sending forty mails is not. */
  const blocked = spec.writes
    ? await guardAction(env, 'connact:w:' + user.email, 10, 100, 'actions on your connected accounts')
    : await guardAction(env, 'connact:r:' + user.email, 60, 1000, 'actions on your connected accounts');
  if(blocked) return blocked;

  const got = await connUse(env, user.email, spec.need, 'action:' + name, { attended: true });
  if(!got.ok){
    /* The capability is the refusal, and it names itself. "Not connected" and
       "connected, but you did not grant that" are different problems with
       different fixes, and telling somebody the first when it is the second
       sends them to reconnect an account that is already fine. */
    const msg = got.code === 'not_connected'
        ? 'No connected account can do that yet. Connect one under Settings, Integrations, and tick the permission this needs.'
      : got.code === 'refresh_failed' || got.code === 'expired_no_refresh'
        ? 'That connection stopped working and needs reconnecting.'
      : got.code === 'unreadable'
        ? 'That connection could not be read on this deployment. Nothing has been disconnected.'
        : 'That could not be done (' + got.code + ').';
    return json({ error: got.code, need: spec.need, message: msg }, 409);
  }

  try{
    const result = await spec.run(got.token, body.args || {});
    /* VERIFY, THEN SAY IT HAPPENED.

       Every write reads its own result back from the provider and reports
       `verified`: true when the change is there, null when it could not be
       checked, false when the provider said yes and the change is not there.
       False is a failure, whatever the status code said - a provider that
       answers 200 and does nothing must not come back to the person as done.
       It is not "nothing was changed" either: AMV cannot know that, and saying
       so would invite a second send. */
    if(spec.writes){
      const v = result && typeof result === 'object' ? result.verified : undefined;
      if(v === undefined){
        audit(env, 'conn_action_unverifiable', { by: user.email, action: name });
        return json({ error:'not_verifiable', action: name,
          message:'AMV has no way to check that, so it is not reporting it as done. Look in the account itself.' }, 500);
      }
      if(v === false){
        audit(env, 'conn_action_not_confirmed', { by: user.email, action: name });
        return json({ error:'not_confirmed', action: name, result,
          message:'The account said yes, but when AMV checked, the change was not there. Look in the account before trying again, so it does not happen twice.' }, 502);
      }
    }
    return json({ ok: true, action: name, result });
  }catch(e){
    /* The provider's own message is logged and NOT returned. It can carry a
       quota name, an internal id, or a hint about the account, and none of that
       belongs in an answer to a browser. */
    audit(env, 'conn_action_failed', { by: user.email, action: name,
      error: String((e && e.message) || e).slice(0, 120) });
    /* AMV's OWN refusals - raised before any request, or naming a file that
       was never handed over - are said as what they are. */
    const why = String((e && e.message) || '');
    const own = {
      docs_not_chosen: 'AMV can only open Google files you chose for it, or ones it made. Choose the file first.',
      sheets_not_chosen: 'AMV can only open Google files you chose for it, or ones it made. Choose the file first.',
      bad_file: 'That is not a Google file AMV can open.',
      bad_range: 'That is not a range in a sheet, like Sheet1!A1:C10.',
      bad_values: 'The values to write must be rows of cells.',
      too_many_cells: 'That is more than 10,000 cells at once. Write it in parts.',
      bad_edit: 'Say what to find and what to replace it with, or what to add at the end.',
    }[why];
    if (own) return json({ error: why, action: name, message: own + ' Nothing was changed.' }, 400);
    return json({ error:'action_failed', action: name,
      message:'That did not work. Nothing was changed.' }, 502);
  }
}

/* WHAT GOOGLE'S FILE PICKER NEEDS IN THE BROWSER (picker.html). All three
   are public by design - a client id, a browser key limited by the site it is
   used from, and a project number - which is why they are handed to the page
   at all. Signed in only, so this is not a directory of the deployment's
   settings for anyone who asks. */
/* ══ AMV'S CLOUD COMPUTER ════════════════════════════════════════════════════

   A machine of the person's own, in AMV's cloud: one container each, running
   the same bridge people run on their own computers (cloud/, --cloud mode).
   The app drives it with the same calls it already makes to a bridge - run a
   command, read and write a file - and they arrive here first, so:

     it exists only where the deployment has it (the AMV_COMPUTER binding and
     a key of real length), and says so plainly where it does not;
     it is a plan's to use (Pro and above), checked here, not in the page;
     the time it is AWAKE is counted against the plan's monthly minutes -
     that is what the cloud provider bills, so it is what is metered: a file
     read every few minutes keeps a machine up as surely as a build does -
     and once they are spent nothing more is sent to it;
     each person reaches only their own container - its name is derived here
     from the signed-in account, never taken from the request. */
const COMPUTER_MIN_PLAN = 'pro';
const COMPUTER_MINUTES = { pro: 600, elite: 3000, ultra: 6000 };
/* How long a machine stays up after its last request (sleepAfter in
   cloud/computer.mjs). Billed when the request is made, so the meter is never
   behind what the provider charges. */
const COMPUTER_AWAKE_S = 300;
function _computerOn(env){ return !!(env && env.AMV_COMPUTER && String(env.AMV_COMPUTER_KEY || '').length >= 32); }
function _computerCap(user){
  const rank = _planRankOf(user.plan, user.customCfg);
  return rank >= PLAN_RANK.ultra ? COMPUTER_MINUTES.ultra : rank >= PLAN_RANK.elite ? COMPUTER_MINUTES.elite
