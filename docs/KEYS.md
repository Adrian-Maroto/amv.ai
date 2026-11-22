# Keys: what to set, in what order, and how to change each one

Build 18 audit B18-029. Every secret below is set with
`npx wrangler secret put NAME` (never in a file, never in chat), first on
staging (`--env staging`), then on production. What each costs and unlocks
is in GO-LIVE.md section 2.0; this page is the order and the rotation.
`docs/AUDIT-BUILD18-STATUS.md` records why it exists.

## Order for a first, small cohort

| # | Secret | Why first | Spend ceiling to set with it |
|---|---|---|---|
| 1 | `JWT_SECRET`, `PASSWORD_PEPPER` | Sign-in works and passwords are safe in a stolen copy | none |
| 2 | `AMV_MODEL_KEY` | Chat, Crew and agents answer at all | `GLOBAL_DAILY_USD_CAP` (default $500 a day) and a monthly limit at the model supplier |
| 3 | `EMAIL_API_KEY` + `RESET_EMAIL_FROM` on a verified domain | Sign-in codes and password resets | the email provider's own plan |
| 4 | `ADMIN_TOKEN`, `ALERT_WEBHOOK` | You can see the console and hear the alarms | none |
| 5 | `MAIL_CRED_KEY`, `CONNECT_KEY` | Connected accounts can be stored at all | none |
| 6 | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (test mode first) | Plans can be bought | Stripe test mode costs nothing |
| 7 | Everything else in GO-LIVE section 2 | Only when a person in the cohort needs it | per provider |

## Changing a key

| Secret | How to change it | What changing it does |
|---|---|---|
| `PASSWORD_PEPPER` | Old value to `PASSWORD_PEPPER_PREVIOUS`, then set the new one | Nothing visible: each password moves to the new pepper at its next sign-in |
| `MAIL_CRED_KEY` | Old value to `MAIL_CRED_KEY_PREVIOUS`, then set the new one; delete PREVIOUS once `cred_resealed` stops appearing in the audit log | Nothing visible: each stored credential is sealed again where it is used |
| `CONNECT_KEY` | Old value to `CONNECT_KEY_PREV`, then set the new one; remove PREV once everyone has reconnected | Connections keep working until they are next renewed |
| `AMV_COMPUTER_KEY` | Old value to `AMV_COMPUTER_KEY_PREVIOUS` in the cloud Worker, new value in both Workers | Machines keep answering (GO-LIVE 2c2) |
| `JWT_SECRET` | Set `AUDIT_ID_KEY` and `BACKUP_SIGNING_KEY` first, then the new value | **Everybody is signed out** and signs in again. Without those two set, log pseudonyms change and older backups stop verifying |
| `ADMIN_TOKEN`, `ALERT_WEBHOOK`, `EMAIL_API_KEY`, `STRIPE_*`, provider keys | Make the new key at the provider, set it, then revoke the old one there | Nothing, if the new one is set before the old is revoked |

After any change: `curl https://api.amv.homes/v1/health/ready` must still
answer `"ready":true`.
