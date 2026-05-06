---
name: Multistop release pallet gate
overview: Optional fleet setting enables release-time Hyperion checks at multistop continue. Mission creators with a dedicated permission can set a per-session override at create time to skip those checks. Otherwise mismatches surface in attention, block continue, and require ack or physical fix.
todos:
  - id: settings-toggle
    content: Add boolean to AmrFleetConfig/settings GET+PUT, AmrSettings UI, default off for safe rollout
  - id: permission-override
    content: Add amr.missions.presenceGateOverride to permissions catalog; enforce on POST multistop body field
    dependencies:
      - settings-toggle
  - id: session-flag
    content: Persist per-session skip flag from create body on amr_multistop_sessions; gate logic skips when flag set or fleet toggle off
    dependencies:
      - permission-override
  - id: derive-expected
    content: Server helper — plan_json + next_segment_index → destination ref + expectPresent (buildSegmentMissionData rules)
    dependencies:
      - session-flag
  - id: attention-enrich
    content: GET /amr/dc/missions/attention — presence mismatch fields when toggle on and session not overridden
    dependencies:
      - derive-expected
  - id: block-continue
    content: executeMultistopContinue + auto-continue respect toggle, session override, and per-segment ack
    dependencies:
      - derive-expected
      - session-flag
  - id: banner-ui
    content: AmrAttentionBanner — mismatch copy, disable Release, Refresh + segment ack API
    dependencies:
      - attention-enrich
      - block-continue
  - id: mission-new-ui
    content: AmrMissionNew — optional override checkbox when user has permission and fleet toggle enabled; pass in createMultistop payload
    dependencies:
      - permission-override
      - settings-toggle
---

# Multistop release-time pallet check (settings, create override, attention + intervention)

## Product direction

- **Do not** use a create-time **confirm dialog** for generic pallet layout rules.
- When **enabled in AMR settings**, at **mission release** (`awaiting_continue` → next segment), compare Hyperion presence at the **segment destination** to the **expected** state (empty for drop, pallet for pickup-only per [`buildSegmentMissionData`](server/lib/amrMultistop.ts)).
- On mismatch: **attention** ([`AmrAttentionBanner`](src/components/amr/AmrAttentionBanner.tsx) / [`GET /amr/dc/missions/attention`](server/routes/amr.ts)), **block** continue (manual + auto), **intervention** via segment ack and/or fixing the stand.
- **Fleet toggle off** (default recommended): **no** presence checks, **no** attention noise — full backward compatibility.
- **Create-time override** (permission-gated): authorized users can opt a **specific multistop session** out of release checks when creating the mission; stored on the session so all release steps skip the gate for that run.

## 1) Settings toggle (global feature flag)

- Add a boolean to [`AmrFleetConfig`](server/lib/amrConfig.ts) / [`publicAmrFleetConfig`](server/lib/amrConfig.ts), e.g. **`multistopReleasePresenceCheckEnabled`** (name final in code).
- **Default `false`** so existing deployments opt in explicitly.
- Wire [`GET/PUT /amr/dc/settings`](server/routes/amr.ts) merge + [`AmrFleetSettings`](src/api/amr.ts) type.
- UI: [`AmrSettings.tsx`](src/routes/amr/AmrSettings.tsx) — checkbox + short help under the polling / Hyperion area (e.g. “When enabled, before each multistop segment release, compare destination stand presence to the plan (requires Hyperion).”).

**Gate behavior:** If toggle is **off**, skip Hyperion calls for this feature, omit presence fields from attention, and allow continue unchanged.

## 2) Permission + mission-creation override

- Add permission **`amr.missions.presenceGateOverride`** in [`permissionsCatalog.ts`](src/lib/permissionsCatalog.ts) (label: e.g. “AMR: bypass multistop release presence checks at mission create”). Assign to appropriate roles (e.g. admin / mission lead) — same pattern as other `amr.*` permissions.
- **POST** [`/amr/dc/missions/multistop`](server/routes/amr.ts) (create body): optional boolean, e.g. **`skipMultistopReleasePresenceCheck`**.
  - If **`true`**: require `req.user` has **`amr.missions.presenceGateOverride`** (and still require normal create permission, e.g. `amr.missions.manage`). If present without permission → **403**.
  - If **`true`** and fleet toggle is **off**: accept but no-op (no checks anyway); or reject as unnecessary — prefer **accept** for simpler client.
- Persist on **`amr_multistop_sessions`**: e.g. **`skip_release_presence_check`** `INTEGER 0/1` default `0`, set from create handler when body requests override and auth OK.

**Runtime:** Attention enrichment, `executeMultistopContinue`, and worker auto-continue **must no-op the gate** when `skip_release_presence_check` is set for that session.

## 3) UI — New mission form

- [`AmrMissionNew.tsx`](src/routes/amr/AmrMissionNew.tsx): when fleet setting **`multistopReleasePresenceCheckEnabled`** is true **and** user has **`amr.missions.presenceGateOverride`**, show a **checkbox** (advanced / warning style): e.g. “Skip release-time pallet checks for this mission (use only when physical layout is verified).”
- Include the boolean in [`buildMultistopPayload`](src/routes/amr/AmrMissionNew.tsx) / API body only when checked.
- **Templates / quick create**: [`AmrMissionTemplates.tsx`](src/routes/amr/AmrMissionTemplates.tsx) — same optional field if UX needs parity (only show when permission + toggle); otherwise omit and default false.

## 4) Destination expectation (segment math)

Unchanged from prior revision:

- Destination ref = `plan.destinations[next_segment_index].position`.
- **`endPutDown`** = final segment OR `destination.putDown === true`.
- Expect **`presence === false`** when dropping; **`presence === true`** when pickup-only end.

Unknown Hyperion → document default (non-blocking vs block); keep consistent across attention + continue.

## 5) Server flow (when toggle **on** and session **not** skipped)

```mermaid
sequenceDiagram
  participant Create as POST_multistop
  participant DB as multistop_session
  participant Attention as GET_attention
  participant Continue as POST_continue

  Create->>DB: insert session skip flag from body plus permission
  Attention->>DB: if not skip and toggle on then evaluate mismatch
  Continue->>DB: if not skip and toggle on then verify or ack
```

- **Per-segment operator ack** (for sessions **without** create override): keep **`POST …/presence-release-ack`** (or equivalent) scoped to **`next_segment_index`**, permission e.g. `amr.missions.manage`, cleared after successful continue — so normal missions still require explicit bypass per segment when mismatched.

## 6) Client — attention banner

- Extend [`AmrMissionAttentionItem`](src/api/amr.ts) when toggle on + not skipped session.
- Disable Release when blocked; Refresh + Ack; message lists ref + expected vs actual.

## Testing

- Toggle **off**: no presence fields; continue always behaves as today.
- Toggle **on**, no override, mismatch → blocked; ack clears for that segment.
- Toggle **on**, session created **with override** (+ permission) → never blocked by this gate.
- Toggle **on**, attempt override **without** permission → **403** on create.
- Template create path aligns with same API rules.

## Out of scope

- Single-segment missions / first `submitMission` only — optional follow-up.
