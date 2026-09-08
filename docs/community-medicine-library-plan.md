# Community medicine reference library — implementation plan

## Status and decision

Proposed. Do not implement piecemeal. The feature crosses the medicine form,
database RPC boundary, private Storage, and the code-gated supporter flow, so
the schema, API, and UI should land as one tested feature branch.

## Product decision

Add a small, shared **Community medicine references** library. Its purpose is
to make common medicines quicker to set up for families and friends.

The library may contain only:

- medicine name;
- strength/power;
- an optional pill photo;
- an optional packet photo.

It must never contain or infer a person, household, supporter, notes, purpose,
amount to take, medicine form, schedule, slot, dose history, notification
setting, or sharing code.

A new manually entered medicine automatically creates a community reference with its name, strength, and any photos. There is no extra permission or confirmation step for this first entry. Choosing an existing library reference is separate: a supporter may use it without sharing anything themselves. Replacing an existing community photo is the only action that requires an explicit review request.

This is a reference aid, not medical advice or a medicine-identification
service. The person setting up the routine remains responsible for checking the
actual packet and strength. Country/manufacturer/package variants, broad public
discovery, and formal moderation are deliberately out of scope for version 1;
this app is initially aimed at a small trusted family-and-friends community.

## Goals

1. After typing atleast two characters in the medicine-name field, start showing a short list
   of matching shared references.
2. A selected reference fills the private medicine's name and strength and can
   supply its available pill and packet photos.
3. The supporter can still enter a new medicine normally, take their own photos,
   or replace a shared photo for only their household.
4. A new manual medicine automatically adds only the permitted fields to the library.
5. Existing household data and photos continue to behave exactly as today.

## Non-goals for v1

- No medicine lookup from external pharmaceutical APIs.
- No claims that an entry is medically verified, universally correct, or
  appropriate for a person.
- No country, manufacturer, barcode, active-ingredient, colour, shape, or
  package-size matching.
- No public profile, contributor name, attribution, comments, ratings, likes,
  or usage count.
- No user-facing editing/deleting of an already published shared reference.
  This prevents a contributor from silently changing the visual reference used
  by another household. Administrative retirement can be a later feature.
- No automatic sharing of current private medicines or all existing photos.

## Terminology

Use consistent language in the product and code:

| Term | Meaning |
| --- | --- |
| private medicine | A `public.medicines` row belonging to exactly one household. |
| community reference | A record in the shared library containing only name, strength, and reference-photo paths. |
| own photo | A photo uploaded for one private medicine; it belongs to that household. |
| community photo | An opt-in photo owned by the library and usable by any household. |
| override | An own photo that takes priority over the selected community photo. |

Avoid describing a community entry as a "prescription," "verified medicine,"
or "the same medicine." In UI copy call it a **reference**.

## User experience

### 1. Search while adding a medicine

The name input remains the first field in the existing supporter medicine form.

- Do not query before two non-space characters; show no empty-state panel.
- Debounce input by about 250–300 ms and cancel/ignore stale responses.
- Return at most five or six results, ordered by a simple name-prefix match,
  then name contains match. Do not add popularity ranking in v1.
- Each result is an easy-to-tap row with:
  - name;
  - strength below it when supplied;
  - `Pill photo`, `Packet photo`, `2 photos`, or `No photos` as text, not an
    icon-only count.
- A row never displays another household, contributor, schedule, or private
  image URL.
- Keep a clear `Continue entering manually` path. Typed text must remain
  editable and the list must not cover the form's next control on small phones.

### 2. Selecting a reference

After a row is selected:

- Fill name and strength from the reference.
- Mark the form with a compact line: `Using a community reference. Check it
  matches the packet you have.`
- If photos exist, show them in the existing pill/packet photo controls as
  `Community reference photo`.
- Do not copy its dose quantity, purpose, notes, schedule, or form because the
  library never stores them.
- Allow `Choose a different reference` and `Stop using reference` actions.
  Stopping removes only the link; it never alters the community entry.
- A supporter may still set their own dose quantity, form, purpose, notes, and
  schedules as they do today.

### 3. Own photos versus shared photos

The photo controls must make source and consequences obvious:

- A community photo is read-only reference content, never silently uploaded
  into the household's private Storage folder.
- `Take/replace with my own photo` creates a household-only override. It does
  not modify the community photo.
- When an override exists, label it `Your photo` and offer `Use community
  photo instead` if a community photo exists. That action deletes only the
  private override after a confirmation.
- If a selected reference has no pill or packet photo, retain the normal upload
  control for that missing kind.
- Existing edit screens with no selected reference retain today's exact photo
  behaviour and labels.

### 4. Automatic first reference at Save

For a new manual medicine with a valid name, saving automatically creates a community reference with its name, strength, and whichever pill/packet photos were uploaded. No extra checkbox, consent screen, or confirmation is shown.

Rules:

- It applies only to a new manual medicine that is not linked to an existing community reference.
- If a matching reference already exists, do not create a duplicate and do not overwrite its photos. Keep the medicine private unless the supporter explicitly selects that existing reference.
- A new reference can have no photos, one photo, or both photos.
- On success, show a quiet toast such as `Added to community references.`
- All schedule, dose quantity, form, purpose, notes, and household details remain private.

### 5. Suggest a better community photo

When a medicine is linked to an existing community reference and the supporter uploads an own-photo override, offer a secondary action beneath that photo only:

`Suggest this as a better community photo`

Selecting it opens a small confirmation: `This photo will be reviewed. Everyone keeps seeing the current community photo unless it is approved.`

On confirmation, create a pending proposal. It never changes the existing reference automatically. The proposal contains only the reference ID, photo kind, candidate photo path, status, and review timestamps.

Create `public.community_photo_suggestions`:

```sql
id                   uuid primary key default gen_random_uuid()
reference_id         uuid not null references public.community_medicine_references(id) on delete restrict
kind                 text not null check (kind in ('pill', 'packet'))
photo_path           text not null
status               text not null default 'pending' check (status in ('pending', 'approved', 'rejected'))
created_at           timestamptz not null default now()
reviewed_at          timestamptz null
review_note          text null check (length(review_note) <= 240)
```

For now, developers review pending rows in Supabase Dashboard. Approving swaps only that reference photo path; rejecting keeps the current photo. Candidate images live in a separate opaque `suggestions/` path in the community bucket and are never shown to other users before approval. A later admin tool can make this review workflow friendly.

### 6. Safety copy and accessibility

- Always retain real text labels next to camera/reference indicators.
- Results must be operable by keyboard: Arrow keys or Tab can reach rows,
  Enter selects, Escape closes the result list without clearing input.
- Announce result count through a polite live region after a settled search.
- Do not rely on colour to distinguish community and own photos; use text and
  source labels.
- Images remain `object-fit: contain`, use existing full-screen photo viewing,
  and retain meaningful alt text based on source and kind.
- The confirmation sentence must be calm and factual, never alarming or
  patronising.

## Data model

Create a new migration after `0020_escalation_from_slot_time.sql`. Do not change
or repurpose private `public.medicines.photo_path` or `packet_photo_path`.

### Shared reference table

Create `public.community_medicine_references`:

```sql
id                    uuid primary key default gen_random_uuid()
name                  text not null
name_search           text not null
strength              text not null default ''
strength_search       text not null
pill_photo_path       text null
packet_photo_path     text null
status                text not null default 'active'
created_at            timestamptz not null default now()
```

Constraints and indexes:

- name after trimming: 1–100 characters, matching the private medicine limit;
- strength: 0–60 characters, matching the private medicine limit;
- `status in ('active', 'retired')`; retired records never appear in search;
- `name_search` and `strength_search` are server-derived, lowercased,
  whitespace-collapsed forms; clients never provide trusted values;
- unique `(name_search, strength_search)` to prevent two identical references;
- btree index suitable for prefix search on `name_search`; at this small scale
  this is sufficient. Add `pg_trgm` only if real search data proves it needed.

Do **not** store a contributor/household ID in this shared table. That is both
unnecessary and a privacy liability. Service-role function logs may retain
operational request information according to Supabase's normal policies, but
the product data model must not make a contributor discoverable.

### Link from a private medicine

Add nullable `community_reference_id uuid` to `public.medicines`, foreign key
to `community_medicine_references(id)` with `on delete restrict`.

This link means “this household chose these shared reference photos.” Private
name, strength, dose quantity, form, purpose, notes, schedules, and own photo
paths remain stored exactly on the private medicine.

When routine data is read, resolve each photo with this precedence:

```text
own private pill photo    → selected community pill photo    → no pill photo
own private packet photo  → selected community packet photo  → no packet photo
```

Return explicit source metadata, for example:

```js
photoPath, photoSource: 'own' | 'community' | null
packetPhotoPath, packetPhotoSource: 'own' | 'community' | null
communityReferenceId, communityReferenceName, communityReferenceStrength
```

Never overwrite a private photo path with a community path. Keeping sources
separate makes private-photo deletion safe and makes reverting to the shared
photo straightforward.

### Storage

Use a separate private bucket, `community-med-photos`, not `med-photos`.

- Object names are opaque UUID paths such as
  `references/<reference-id>/pill/<uuid>.jpg`; no household ID, name, or
  contributor identity appears in a path.
- Same JPEG compression and 512 KB upper limit as the current photo flow.
- Bucket is private; no public object URLs.
- Only the new server-side function may upload, replace, or create signed URLs.
- A private medicine's photo delete endpoint must only ever delete from
  `med-photos`; it must never delete a community object.
- Published community images are immutable in v1. The later retirement process
  hides a reference from search rather than mutating what existing households
  have already selected.

## Backend/API design

### Why use a dedicated Edge Function

The existing supporter has no authenticated Supabase session: its household
share code is its credential. Direct table or Storage policies would either
leak catalogue data, reveal object paths, or create a broad anonymous write
surface. Create `supabase/functions/community-medicine/index.ts`, deployed with
`--no-verify-jwt` and with the same CORS pattern as `supporter-photo`; the
function itself validates every request.

It should use the service-role client internally and expose exactly three
actions:

| Action | Input | Output | Permission / rules |
| --- | --- | --- | --- |
| `search` | valid `code`, query | safe reference summaries | query 3–100 chars, normalized; max 6 active rows; no paths or contributor data |
| `getUrls` | valid `code`, reference ID | short-lived signed pill/packet URLs | only for an existing active or already-linked reference; URLs expire around 5 min |
| `publish` | valid `code`, name, strength, optional compressed pill/packet base64 | safe reference summary and signed URLs | creates only a first, non-duplicate community reference; never overwrites an existing entry |
| `suggestReplacement` | valid `code`, reference ID, kind, compressed JPEG | pending proposal summary | requires an explicit `confirmReplacement: true`; stores a review candidate only |

For owner-authenticated elder flows added later, accept an Authorization bearer
token instead of a code and verify `auth.getUser(token)` plus ownership of a
household. Do not implement a “code optional means anonymous” path.

### Search implementation

- Normalize `query` by trim, lowercasing, and collapsing whitespace.
- Reject a query shorter than three characters after normalization.
- Use parameterized Supabase/Postgres filters; never concatenate query into SQL.
- Search active references only.
- Return `id`, display `name`, display `strength`, and two booleans
  `hasPillPhoto`, `hasPacketPhoto` only.
- Do not return object paths in search results or browser-visible API payloads.
- Enforce a modest per-code/per-IP request limit if Supabase tooling makes it
  easy. If not, retain debounce, minimum query length and max results, document
  it as an operational follow-up, and do not falsely call the endpoint public.

### Automatic publication implementation

The operation needs to avoid races and partial state. Implement the database
record creation/de-duplication as one RPC/function or transaction-like server
operation, then handle photos deliberately:

1. Validate a valid code, name, strength lengths, and JPEG base64 size.
2. Normalize name and strength server-side.
3. Look for an active reference with the same normalized name + strength.
4. If it exists, return `{ kind: 'duplicate', reference }`; do not upload or overwrite any image.
5. If none exists, create the reference row, upload supplied photos to the separate bucket, then update only its two community photo paths.
6. If an upload fails, keep the reference with any successfully uploaded photo and return clear partial-success feedback.
7. `suggestReplacement` validates `confirmReplacement: true`, stores its photo only as a pending candidate, and creates a suggestion row. It never modifies the active reference.
8. Return safe summaries only; never raw Storage paths.

The implementation must check every Supabase query/upload/update error. The
current `supporter-photo` function should be tightened opportunistically to
check its update result too, but that is separate from this feature's behavior.

### Private medicine save integration

Extend `public.upsert_medicine` and `public.get_routine` to accept/return
`communityReferenceId` and resolved community photo/source metadata.

- `upsert_medicine` validates that the provided reference ID is active before
  storing the link. It must not permit a supporter to link arbitrary UUIDs.
- Its JSON return includes the link and source metadata needed by the form.
- `get_routine` joins the reference with a `left join`, resolving image path
  precedence server-side. It must return no community object path to a
  supporter; instead, the new Edge Function produces signed URLs.
- Since `get_routine` currently transports private photo paths and the
  supporter obtains signed URLs via `supporter-photo`, extend the client
  photo-loading abstraction so it knows whether it needs the household photo
  endpoint or community `getUrls`. Do not attempt to use a community path with
  `supporter-photo`.
- Update `js/sync.js` and every routine mapper so cached data preserves source
  metadata. Verify old cached routines (without the new keys) still render as
  private/no-photo data.

## Frontend implementation map

### New module: `js/community-medicines.js`

Keep network access out of `medicine-form.js`.

Export narrow helpers:

- `searchReferences(code, query)`;
- `getReferenceUrls(code, referenceId)`;
- `publishReference(code, payload)`;
- `suggestPhotoReplacement(code, payload)`;
- data-shape validators/normalizers shared with the form where useful.

Use the existing light `functionsClient()` / supporter transport, not the full
authenticated Supabase client, because the supporter route is intentionally
small and code-gated.

### Update `js/views/medicine-form.js`

- Add state for `selectedReference`, search request sequence/abort state,
  `replacementSuggestionRequested`, and separately loaded community URLs.
- Preserve the current working-copy and partial-redraw architecture; search
  results should be a small, replaceable node, not a whole-form redraw on every
  keystroke.
- Wire selection to name/strength only; do not infer any other private fields.
- Teach `photoField(kind)` to render source label, own override, community
  fallback, and the correct action wording.
- Save private medicine first, then apply private own-photo uploads through the
  existing endpoint, then automatically publish a first reference for a new manual medicine. Do
  not make a failed community publication roll back a successfully saved
  private medicine.
- If a user picks an existing reference, include `communityReferenceId` in the
  normal medicine save. No community write is necessary.
- On duplicate publication response, keep the private medicine saved and show a focused choice to link it to the existing reference; do not discard the person's form values.
- On an imported medicine, render `Suggest this as a better community photo` only after an own photo exists. The confirmation calls `suggestPhotoReplacement`; the own photo remains private regardless of the proposal outcome.
- Disable repeated Save taps and retain the existing spinner/error model.

### Update routing, routine and photo consumers

Inspect and update all places that read medicine photos, including:

- `js/supporter.js` / `js/supporter-sync.js`;
- `js/sync.js`;
- `js/views/day.js`;
- `js/views/medicines.js` and medicine-detail view if separate;
- `js/organiser.js` and organiser views;
- `js/views/medicine-form.js`.

Every consumer should use resolved display URL plus source metadata. No current
view may assume every `photoPath` is a household bucket path.

### Copy and styles

- Put every new string in `js/strings.js`.
- Add compact visual source badges in `css/app.css` using current tokens. The
  community badge is informational, not a success or warning colour.
- Keep results and the replacement-suggestion action large enough for the app's older-user audience.
- Avoid thumbnails inside the search list for v1: image URLs add latency and a
  wrong-looking thumbnail can create false confidence. The count is enough;
  photos appear after explicit selection.

## Security and privacy requirements

1. No `community_medicine_references` direct browser table grants. Revoke
   `anon` and `authenticated` table access; only service role accesses it.
2. New storage bucket remains private and has no broad `storage.objects`
   policies. Signed URLs are issued only after code/auth validation.
3. The share code is validated before every search, URL, publication, and replacement-suggestion request. A mere reference ID is never sufficient.
4. API responses contain no household ID, owner ID, contributor ID, raw object
   path, internal timestamps, notes, schedule, or private medication ID.
5. Replacement proposals require `confirmReplacement: true` on the server, not merely a client-side confirmation.
6. Validate MIME/type after decoding where practical, accepted byte size, and
   dimensions/compression on the client. Reject unexpected payloads.
7. Use CORS headers on every success and failure, answer `OPTIONS` with 200,
   and deploy this browser-facing function with `--no-verify-jwt` only because
   it performs its own share-code/auth validation.
8. Record operational errors without logging share codes, image bytes, or raw
   personal data.
9. Do not use community records in reminder functions, push payloads, calendar
   snapshots, exports, or supporter escalation data except for resolving the
   display photo in routine reads.

## Migration and deployment sequence

1. Write migration `0021_community_medicine_references.sql` with tables,
   indexes, foreign key, grants/revokes, and updated RPC functions.
2. Review it in a disposable/local Supabase project or transaction-like SQL
   test first. Confirm existing routines and old snapshot shapes still work.
3. Implement and test `community-medicine` Edge Function locally.
4. Implement client changes behind the migration-compatible data handling.
5. Apply the migration to production.
6. Deploy the new function:

   ```bash
   npx supabase functions deploy community-medicine --project-ref <project-ref> --no-verify-jwt
   ```

7. Deploy the static site only after the function is live. The app must still
   degrade gracefully if an old static client lacks the new UI.
8. Update `supabase/README.md`, `docs/setup.md`, `docs/repo-structure.md`, and
   `docs/architecture.md` with bucket/function setup and privacy boundaries.

## Acceptance tests

### Private data boundaries

- Search responses contain only allowed fields.
- A routine response contains no contributor/household identity from a
  reference.
- Private notes, purpose, dosage quantity, form, schedules, dose logs, and
  reminders never appear in the catalogue database rows or function responses.
- Changing/deleting an own override cannot delete or alter a community photo.
- Retiring a reference removes it from future search without deleting private
  medicines or their schedules.

### Search and selection

- One/two-character input sends no request; three-character input returns at
  most six active matches.
- Fast typing cannot show stale results for an earlier query.
- Keyboard, touch, screen-reader and 320px-wide phone interactions work.
- Selecting a reference fills only name and strength, shows source labels, and
  leaves all treatment fields untouched.
- A selected reference's photos display in Today, medicine list/detail, and
  organiser using a valid short-lived signed URL.
- Existing medicines, no-reference medicines, and missing-photo states are
  unchanged.

### Community publication and replacement suggestions

- A new manual medicine automatically publishes name/strength with none, one, or two photos; no consent checkbox appears.
- A duplicate name+strength cannot create a second entry or overwrite its images, even with simultaneous requests.
- A private save succeeds even if automatic publication fails, with truthful feedback.
- A replacement proposal requires explicit confirmation and never changes the live reference until a developer approves it.
- A rejected proposal leaves both the current community photo and the supporter's own override unchanged.
- Image upload failures produce no broken public URL and do not damage the private photo.

### Regression and security

- Supporter can still add, edit, archive, schedule, and upload/delete private
  photos with only a share code.
- Authenticated elder can still load offline cache and sync doses.
- The Edge Function correctly answers CORS preflight from localhost and GitHub
  Pages, then rejects invalid/missing codes on POST.
- Light/dark themes, reduced motion, and browser back navigation pass.
- Run repository checks, SQL migration review, and manual end-to-end testing on
  a new manual medicine, an existing reference, and an offline/failed-network
  scenario.

## Suggested implementation order

1. **Backend foundation:** migration, private bucket, safe function contracts,
   and automated/manual response-shape tests. No UI yet.
2. **Read path:** search action, client module, form result list and selection;
   use text-only photo availability labels first.
3. **Photo resolution:** reference link, signed URL loading, source metadata,
   and all photo-consuming views.
4. **Automatic publication and review proposals:** first-entry publication, duplicate handling, replacement-candidate upload, and truthful success/partial-failure feedback.
5. **Hardening:** accessibility pass, CORS/auth negative tests, docs, privacy
   review, mobile QA, and production deployment.

Keep each step independently reviewable. Do not merge a UI that can select a
reference until the backend makes its image paths private and safe to resolve.

## Later decisions, deliberately deferred

Only revisit these after there is real usage data:

- manufacturer, country, barcode and active ingredient fields;
- trusted-curator/admin review, reporting, and retirement UI;
- typo/alias matching and more advanced search;
- popularity/quality ranking;
- translated names and local packaging variants;
- a user-facing contribution history or removal request process;
- automated image safety scanning and rate limiting beyond the initial
  share-code-gated constraints.

