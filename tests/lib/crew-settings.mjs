/* Crew's settings for background work moved from a section on the Crew page
   into a dialog opened from the gear in Crew's header (Nov 10). The suites
   that test those controls - the autonomy ceiling, standing instructions,
   quiet hours, the never list - test them where they now live: this keeps the
   dialog open whenever Crew draws, exactly as if the person had pressed the
   gear, so every lookup reaches the real control. */
export async function keepCrewSettingsOpen(page) {
  await page.evaluate(async () => {
    if (typeof window.renderCrewView !== 'function' || typeof window.openCrewSettings !== 'function') {
      setTab('crew');
      for (let i = 0; i < 100 && typeof window.openCrewSettings !== 'function'; i++) await new Promise(r => setTimeout(r, 50));
    }
    if (window.__crewSettingsKept) return;
    window.__crewSettingsKept = true;
    const draw = window.renderCrewView;
    window.renderCrewView = function () {
      const out = draw.apply(this, arguments);
      try { openCrewSettings(); } catch (e) {}
      return out;
    };
  });
}
