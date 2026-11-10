# C09.02 — Navigation state ownership (Batch 01)

Approved source: dung `5a1e98e`; official Batch 01 task numbering applies.
This table is established before navigation changes. Protected modules and API/security behavior stay unchanged.

| State | Current owner | Same-project navigation | Project change | Logout/account change | Preservation strategy |
| --- | --- | --- | --- | --- | --- |
| Session, login fields | App / existing ApiClient | Retain | Retain session | Portal unmounts, password cleared | Keep existing auth flow and user-keyed Portal |
| Selected project ID | Projects | Retain | Select exact new ID | Reset | Lift only selected ID into Portal to coordinate URL; ProjectDetail stays keyed by ID |
| Project role/members | ProjectDetail | Retain | Old component unmounts; old reads abort; new detail starts empty | Reset | Keep current lifecycle, role guards and Promise.all |
| File page/list/selected version map | Files | Retain mounted instance | Reset via project key | Reset | Navigation scrolls to existing sections; does not unmount Files |
| File target, upload session/Version ID, upload progress | Files / UploadPanel | Retain mounted instance | Existing abort/cleanup, never retry uncertain PUT | Existing abort/cleanup | Do not refactor upload logic or persist session/URL to storage |
| Polling controllers/timers | Files / UploadPanel | Continue existing bounded polling | Existing cancellation | Existing cancellation | Keep original component subtree and helpers |
| DRAFT form and selected FileVersions | Files / CreateHandover | Retain | Reset | Reset | No switch to filename/latest identity |
| Active handover ID | Portal | Retain, independent of project | Retain (recipient may be external) | Reset | Keep current owner; valid hash UUID may select package; invalid UUID never fetched |
| Handover manifest/action/clock | HandoverView | Retain | Independent of project selection | Reset | Keep component and original immutable handover key/cancellation |
| Mobile navigation expanded state | New AppShell | Close on navigation/Escape | Close | Reset | In-flow mobile panel, no modal overlay or keyboard trap |

## Navigation decision

Batch 01 uses hash URLs and section navigation within the existing mounted workspace.
Supported destinations: projects, open-handover UUID, selected project overview/files/members.
Project navigation changes the selected project only for a validated UUID. Back/Forward/reload are read/navigation operations and never create mutations.
The global handover entry remains independent of project membership. A valid handover UUID in the hash is still authorized by the backend.

The files/member/upload/handover screens are deliberately not split into separate unmounting routes in this batch.
This preserves their current state and avoids broad refactors outside C09.01–04. The sidebar provides real section links,
not fake menus or unsupported listing/statistics endpoints. `/portal/#/...` works without a new Nginx history fallback.

Native scroll/focus targets are presentation-only. On project change the old subtree disappears before the new detail is shown.
No password, CSRF, download URL or business state is stored in localStorage/sessionStorage. No protected helper is changed.

## Required checks

Existing auth/security, exact-version, upload and handover assertions remain.
Add hash parser cases, Back/Forward/reload/invalid UUID checks, mobile keyboard/menu checks,
same-project selected-version/upload-session retention and cross-project reset/late-response checks.
Run full PRE_AWS checks before completing C09.02. Keep baseline UUID-pattern and aged-file-link findings outside this batch.

## Batch 01 UI review fix

Global destinations now render one visible screen: project list, selected project workspace, or handover opener.
Inactive screen wrappers use native `hidden` plus `inert`: no layout, accessibility tree or keyboard focus.
Projects/ProjectDetail/Files and Handovers stay mounted with their existing keys and cancellation lifecycles.
Only changing project ID or account keeps the existing reset/unmount behavior. Same-project navigation,
upload/polling, selected FileVersions, DRAFT fields and handover state survive hidden screens.
Hash parser/API semantics are unchanged. Existing assertions are kept; tests navigate to the visible screen
before interacting rather than depending on all screens sharing one long document.

## Batch 02 — Member actions and FileVersion download

Member mutation state stays in the project-keyed ProjectDetail. A single AbortController
guards PUT/DELETE; project/account unmount aborts it and late results are ignored. Removing
a member requires inline confirmation. OWNER is immutable in both row and form controls;
the backend remains authoritative. UUID validation accepts trimmed canonical UUIDs.

FileVersion page and selection ownership are unchanged. IDs in the selection map and
handover payload remain FileVersion IDs; filename and S3 Version ID are never substituted.
UploadPanel, its session, bounded polling helpers and handover lifecycle are unchanged.

Files owns one manual read/download controller and one validated download response. A new
download, state check, list reload or new-version target clears the prior URL. HTTP
401/403/404 clears the project detail through onAccessLost; the existing global 401
session handler still owns authentication expiry. Other failures retain valid selection.
Cancellation is checked before publishing read results or errors.

ExpiringDownloadLink owns only a timeout for that response's expiresAt. It removes the
anchor at expiry and rechecks the existing protected downloadUrl helper on activation.
Hidden same-project screens retain the component and its expiry timer; project/account
unmount clears it. A renewed response uses a new keyed instance. No URL or selection is
persisted in browser storage, and no automatic request/retry is added.
