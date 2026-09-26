/* ============================================================
   LINKED ACCOUNTS - REMOVED. FAMILY IS THE ONE LINK.

   This file used to hold AMVFamily: invitations for one AMV account to read
   another's email, send email as them, change their calendar, see their
   location and spend on their account, each granted by a code emailed to the
   account being reached, and a connector that let chat and Crew request and
   check that access.

   The owner removed it as a security risk, and that is the right call at any
   scale: "let me act as another account" is the account-takeover feature,
   and however carefully it was gated, the distance between a stranger and
   somebody's inbox was one code in the right email. The server now refuses
   every invitation that is not a family one (code `link_removed`), refuses to
   accept any that were sent before, and switches off existing links as it
   finds them.

   Family stays, and is in 25-money-family-ui.js: a parent pays for a child's
   AMV and sets what it may spend, and never sees what the child writes. It
   talks to the server directly (AMV_API.familyInvite / familyPending /
   familyAccept / familyDecline), so nothing here is needed for it.

   What is left is the cleanup: the local copy of links this module kept in
   the browser is deleted, so no screen or tool can read a grant that no
   longer exists.
   ============================================================ */
try{ localStorage.removeItem('amv_links'); }catch(e){}
