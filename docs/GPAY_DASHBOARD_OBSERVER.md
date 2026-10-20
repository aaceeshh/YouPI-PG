# Google Pay for Business dashboard observer

The `gpay-observer` workspace reads Google Pay for Business Transactions using a dedicated Playwright browser profile. It supports the previously inspected English table: Date, Payer, UPI transaction ID, Payment app, Amount and Status. Payer names and payment-app labels are discarded before persistence.

Only `Settled` receipts are delivered; `Scheduled to settle` is not confirmed. The observer preserves the 12-digit RRN, including leading zeroes, converts INR to integer paise, and interprets dates as IST.

The live merchant page was inspected on 20 October 2026. Its seven-column DOM includes one blank column, and Date has `aria-sort="descending"`. Scans cover the last 48 hours by default (`GPAY_LOOKBACK_HOURS`, 24-168) instead of repeatedly reading the full history. Each page must retain descending sort and timestamps; after reaching older receipts, scanning stops. If the page limit is reached before covering the configured window, no truncated result is published. Receipts older than that window require independent historical reconciliation.

## Ownership and wallet credit

The dashboard does not expose a trustworthy reseller order reference or full payer identity. Therefore this integration stores receipts for reconciliation. It does not call the amount-based attribution engine, emit payment SUCCESS, credit wallets, or bypass ownership review. The reseller wallet remains independent. Automatic credit requires a separate trustworthy order-to-payment binding that this dashboard alone does not provide.

## Setup

1. Install Node.js 24 and dependencies using `npm ci --ignore-scripts`.
2. Install the matching browser with `npx playwright install chromium`. On Linux, install OS dependencies using `npx playwright install-deps chromium` as administrator.
3. Configure the GPAY variables in a private `.env`. `OBSERVER_API_TOKEN` must equal the payment API's observer credential. Never put tokens in a dashboard URL.
4. Find the gateway receiving-account UUID for VPA `7449787234@okbizaxis`. The receiving merchant name is Amit Enterprise.
5. Verify that the chosen Transactions dashboard belongs to this account. With admin bearer authentication, send `POST /api/v1/admin/gpay/link` with `{ "receivingAccountId": "<account UUID>", "dashboardMerchantId": "<final dashboard URL path component>", "payeeVpa": "7449787234@okbizaxis", "ownershipVerified": true }`. Existing mappings cannot silently be replaced.
6. Stop the background observer and run `npm run gpay:login` in a graphical desktop. Sign in and complete MFA yourself. Press Enter when the Transactions table is visible. Use a private remote desktop or SSH-forwarded graphical session on a server; do not expose browser debugging or an unauthenticated desktop publicly.
7. Run `npm run gpay:once` for one complete scan and delivery, then `npm run gpay:worker` for continuous observation. Login and worker must use the same service user, browser installation and profile directory.

The URL must be `https://pay.google.com/g4b/transactions/<merchant-id>`. Other origins, settings pages, URL credentials, queries and fragments are rejected. No daily Chrome profile is copied. No password is recorded by this application, though the browser profile contains sensitive login cookies.

## Operation

- `POST /api/v1/pollers/gpay/receipts` requires observer/admin authentication, a linked dashboard, and the matching active receiving account and VPA. At most 100 receipts per batch. Repeated identical receipts are idempotent; conflicting RRN/amount/timestamp combinations roll back the entire batch.
- `GET /api/v1/admin/gpay/receipts/<account UUID>` requires admin authentication and returns the newest 100 receipts with `reviewRequired: true`.
- `GPAY_HEALTH_PATH` is written atomically. `HEALTHY` is valid only while its timestamp is fresh; after three polling intervals treat it as stale.
- Login expiry, changed columns, conflicting receipts, future receipts, stalled pagination or reaching the page limit stop verification. No partial scan is delivered. Inspect the dashboard before increasing the page limit.
- Failed delivery remains in a persistent SQLite outbox. Retrying after a lost acknowledgement cannot duplicate receipts in the gateway.
- Empty receipt batches are authenticated heartbeats. The worker validates gateway connectivity and account mapping even when no new receipts have arrived, before reporting `HEALTHY`.
- Back up the gateway database, observer database and dedicated profile privately. They contain financial receipts or authenticated sessions; never upload them to GitHub.
- The worker changes only transaction-list filters and reads rows. It does not initiate payments, edit merchant settings, solve CAPTCHAs or bypass MFA.

## Linux service

`deploy/youpi-gpay-observer.service` targets `/opt/youpi-pg`, a `youpi` user/group, `/usr/bin/node` and `/etc/youpi/gpay-observer.env`. Confirm the Node path before installation. Create `/opt/youpi-pg/data` owned by `youpi`. Install Chromium under `PLAYWRIGHT_BROWSERS_PATH` and perform login as that same user. Copy the unit to `/etc/systemd/system/`, run `systemctl daemon-reload`, then `systemctl enable --now youpi-gpay-observer`.

The unit restricts writes to the data directory and stops retrying after repeated failures. Stop it before interactive login to avoid profile locks. After login, run `systemctl reset-failed youpi-gpay-observer` and restart it. Check `journalctl -u youpi-gpay-observer` and the fresh health file. The payment API and checkout also need their own persistent services; this unit runs the observer only.

## Validation limits

Tests use fixtures and isolated databases. They cover parsing, auth, wrong origins, duplicates, conflicting receipts, incomplete pagination and restart recovery. A real merchant login, exact dashboard inspection and end-to-end reconciliation remain necessary before activation. Google may block automation or expire a session; hosting does not guarantee continued Google access.
