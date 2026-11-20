# Admin account controls

`PATCH /api/v1/admin/users/:userId/suspend` is restricted to authenticated,
active ADMIN accounts. Send a strict JSON body containing `isSuspended`
(boolean) and `reason` (trimmed, 1–500 characters). The response contains the
updated user projection. Repeating the current state is idempotent.

Suspension revokes every unrevoked refresh token and blocks protected HTTP
requests immediately, including requests made with an already-issued access
token. New authenticated socket handshakes are rejected; currently established
socket connections are not actively disconnected. Pending orders are cancelled,
their reserved cash is released, and order lifecycle events are recorded.
Unsuspension allows new login/refresh sessions but does not restore revoked
refresh tokens or cancelled orders. Self-suspension and suspension of the last
active administrator are rejected.

Each state change writes `AdminAccountAction` with actor ID, target ID, action,
reason, and timestamp. Repeated no-op requests do not create audit rows.

The `/admin` console's Users tab lists users and shows selected account details.
Its status action prompts for confirmation and a reason, then refreshes both the
user list and selected detail. Backend authorization remains authoritative.

## Verification

Run focused backend coverage with:

```sh
cd backend && npx jest tests/integration/adminUsers.integration.test.js --runInBand
```

The frontend has no test runner configured. Manual check: sign in as an ADMIN,
open `/admin`, select an account in the Users tab, suspend it with a reason, confirm the
status updates, and verify its existing access token is rejected and refresh
token no longer works. Unsuspend the account and verify list/detail update;
the old refresh token remains revoked. Also verify the UI reports a rejected
non-admin request, that self-suspension and suspension of the last active admin
are rejected, and that suspending a user with a pending order cancels it and
releases its reserved cash.
