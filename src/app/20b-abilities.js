/* ══════════════════════════════════════════════════════════════════════════
   WHAT AMV CAN DO - ITS OWN SECTION, BECAUSE IT WAS HIDING.

   Two true things about this product were invisible, and between them they
   made it look far smaller than it is.

   THE PER-COUNTRY LIST READS AS A CAP. `EVERYDAY_BY_COUNTRY` holds five jobs
   for each of forty-five countries, and it exists to answer "does this do
   anything where I live" for somebody who has not signed up yet. It is a
   MENU OF EXAMPLES. But a screen that shows five things and nothing else is
   read as five things being all there is - so the honest catalogue was doing
   the work of a limit.

   THE CONNECTORS WERE BURIED. The bridge can start any server in the public
   registry that ships a package, which is thousands of them, and that is the
   real answer to "can it do X" for almost any X. It lived behind a row in
   Integrations.

   So this says the ceiling first and the examples second, which is the
   opposite order to how it was arranged before.

   NO INVENTED HEADLINE NUMBER. There is a figure in the connector directory's
   own comment for how many servers are startable, and it is not put on this
   screen, because the endpoint returns a PAGE and has no total in it - so any
   number here would be a claim nothing in the product could check. What is
   shown instead is what genuinely comes back. A number nobody can verify is
   the first thing a sceptical reader tests, and the only one they need to
   catch out.
   ══════════════════════════════════════════════════════════════════════════ */

/* Each row is a real capability with a real way in. `go` is what the button
   does; a row with nowhere to go would be a boast. */
const ABILITY_GROUPS = [
  { k: 'build', t: 'Build things',
    rows: [
      ['Write and run code', 'Python and JavaScript run in the page, and AMV debugs its own output until it works.', 'build'],
      ['Ship an app to a live URL', 'Describe it, watch it built, deploy it. The address is yours.', 'build'],
      ['Work on your own computer', 'The bridge gives AMV a real filesystem and shell, with consent for every turn and an Undo that writes bytes back.', 'bridge'],
      ['Make a game', 'Host one for friends over a link - no account needed to play.', 'games'],
    ] },
  { k: 'know', t: 'Find things out',
    rows: [
      ['Research with sources', 'Reads the live web and says where each claim came from.', 'chat'],
      ['Read your documents', 'PDFs, spreadsheets, images, code. It reads what you upload; it does not invent one.', 'chat'],
      ['Watch for what changes', 'Standing jobs that run on their own and tell you only when something moved.', 'tasks'],
    ] },
  { k: 'life', t: 'Handle the everyday',
    rows: [
      ['Your mail and calendar', 'Connected properly, so it can read the week and draft from your own address.', 'integrations'],
      ['Money and spending', 'Balances, unusual charges and low-balance warnings, read-only by design.', 'spend'],
      ['Find and apply for work', 'Job boards in your country. Where an address is published AMV sends it; elsewhere it fills the form and you tap.', 'jobs'],
    ] },
];

/* The country catalogue, said as what it is. */
function _abCountryLine(d) {
  if (!d || !d.totals) return '';
  const t = d.totals;
  return escH(String(t.countries)) + ' countries, ' + escH(String(t.everydayJobs))
       + ' everyday jobs and ' + escH(String(t.jobBoards)) + ' job boards';
}

async function renderAbilitiesView() {
  const vc = $('vc'); if (!vc) return;
  vc.innerHTML =
    '<div class="sv fi"><div class="vi ab">'
      + '<div class="ab-head">'
        + '<span class="eyebrow">' + escH(T('What AMV can do')) + '</span>'
        + '<h2 class="ab-t">' + escH(T('There is no list of five things')) + '</h2>'
        /* THE SENTENCE THIS WHOLE SCREEN EXISTS FOR. */
        + '<p class="ab-sub">' + escH(T('AMV connects to programs other people wrote, and runs them on your own computer. That is the ceiling - not a feature list somebody finished writing. What is below is what it does out of the box.')) + '</p>'
      + '</div>'
      + '<div class="ab-ceiling" id="ab-ceiling"></div>'
      + ABILITY_GROUPS.map(g =>
          '<div class="ab-g"><h3 class="ab-g-t">' + escH(T(g.t)) + '</h3><div class="ab-rows">'
          + g.rows.map(([name, desc, go]) =>
              '<button type="button" class="ab-row" data-ab-go="' + escH(go) + '">'
                + '<span class="ab-n">' + escH(T(name)) + '</span>'
                + '<span class="ab-d">' + escH(T(desc)) + '</span>'
              + '</button>').join('')
          + '</div></div>').join('')
      + '<div class="ab-world" id="ab-world"></div>'
    + '</div></div>';

  vc.querySelectorAll('[data-ab-go]').forEach(b => on(b, 'click', () => {
    const to = b.dataset.abGo;
    /* NAMED FOR WHERE THEY ACTUALLY LIVE, NOT WHERE THEY SOUND LIKE THEY DO.

       The first version sent the bridge row to `openBridgeCard()`, a function
       this codebase does not have - the card is rendered inside Integrations,
       not from a door of its own. The gate caught it, which is exactly what
       that check is for: a guard on a name that exists nowhere can never pass,
       so the row would have silently done nothing at all. */
    const WHERE = { bridge: 'integrations', games: 'crew' };
    try { setTab(WHERE[to] || to); }
    catch (e) { try { setTab('chat'); } catch (e2) {} }
  }));

  /* THE CEILING, FROM THE REGISTRY ITSELF.

     Asked live rather than stated, so the screen can only ever claim what
     actually came back. A deployment that cannot reach the registry says so
     instead of showing a number it did not fetch. */
  const cz = $('ab-ceiling');
  if (cz) {
    cz.innerHTML = '<p class="ab-load">' + escH(T('Checking what AMV can connect to…')) + '</p>';
    let names = [];
    try {
      const r = await AMV_API.connectors('', '', 8);
      names = (r && Array.isArray(r.servers)) ? r.servers.slice(0, 8) : [];
    } catch (e) { names = []; }
    cz.innerHTML = names.length
      ? '<div class="ab-c-h">' + escH(T('Connects to programs other people wrote')) + '</div>'
        + '<p class="ab-c-p">' + escH(T('Anything in the public connector registry that AMV’s bridge can start. These came back just now:')) + '</p>'
        + '<div class="ab-chips">'
          + names.map(s => '<span class="ab-chip">' + escH(String((s && (s.name || s.id)) || '')) + '</span>').join('')
        + '</div>'
        + '<button type="button" class="btn bs ab-more" data-ab-go="integrations">' + escH(T('See the directory')) + '</button>'
      /* Honest, and specific about which of the two it is: not connected is a
         setup step, unreachable is a network. Telling somebody to check their
         connection when the answer is a missing key wastes their afternoon. */
      : '<div class="ab-c-h">' + escH(T('Connects to programs other people wrote')) + '</div>'
        + '<p class="ab-c-p">' + escH(T('The connector directory could not be reached from here, so this cannot say what is in it right now. It needs the AMV backend connected.')) + '</p>';
    cz.querySelectorAll('[data-ab-go]').forEach(b => on(b, 'click', () => { try { setTab('integrations'); } catch (e) {} }));
  }

  /* And the country catalogue LAST, named as examples. */
  const wz = $('ab-world');
  if (wz) {
    let d = null;
    try { d = await AMV_API.coverage(); } catch (e) { d = null; }
    if (d && d.totals) {
      wz.innerHTML =
        '<h3 class="ab-g-t">' + escH(T('Where you live')) + '</h3>'
        /* The correction, in one sentence, on the screen that caused it. */
        + '<p class="ab-w-p">' + escH(T('AMV knows what people actually deal with in')) + ' ' + _abCountryLine(d) + '. '
          + escH(T('Those are examples written for each country, not a limit - anything above works everywhere.')) + '</p>'
        + '<button type="button" class="btn bs" id="ab-world-go">' + escH(T('See your country')) + '</button>';
      on($('ab-world-go'), 'click', () => { try { openCoverage(); } catch (e) {} });
    } else { wz.innerHTML = ''; }
  }
}
try { window.renderAbilitiesView = renderAbilitiesView; } catch (e) {}
