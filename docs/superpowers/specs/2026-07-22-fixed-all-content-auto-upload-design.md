# Fixed All-Content Auto Upload Design

## Goal

Simplify the auto-upload settings screen so users can only enable or disable
auto upload. When enabled, auto upload always synchronizes all album content.

## Scope

- Keep the auto-upload switch interactive.
- Remove the complete sync-range section from `AutoUploadSettingsScreen`.
- Remove the "From Now On" and "Custom Time" entry points and the custom date
  picker from that screen.
- Keep the album source as the only fixed source while auto upload is enabled.
- Always save an enabled configuration with `timeRangeMode: 'all'` and no
  `customTimeFrom` value, regardless of the previously persisted range.

The native DTO, persistence schema, native range policies, and the separate
album workbench configuration UI are outside this change. They retain their
existing range-mode support.

## Screen Behavior

The plan card continues to show the effective range summary as "All Content"
when auto upload is enabled and "N/A" when disabled. The detailed sync-range
section is not rendered in either state.

Configuration hydration reads only the saved enabled state needed by the
switch. Previously saved `from_now`, `from_today`, or `custom` values do not
affect the screen. The next successful switch-on flow normalizes the saved
configuration to `all` before starting native auto upload.

The existing permission preflight, save-before-enable ordering, rapid-toggle
guard, error recovery, disable flow, navigation, and fixed album source remain
unchanged.

## Implementation

Remove range-specific component state, conversion helpers, date-picker event
handlers, range copy lookups, icons, modal rendering, and styles from
`AutoUploadSettingsScreen`. Replace its enable persistence helper inputs with a
fixed payload:

```ts
{
  enabled: true,
  timeRangeMode: 'all',
  customTimeFrom: undefined,
}
```

No shared contract or native module changes are required.

## Testing

Update the screen tests first and confirm they fail against the current UI.
The tests will verify that:

- no sync-range title, option, or custom picker is rendered;
- the plan summary reports "All Content" while enabled;
- enabling from any previously persisted range saves `all` with no custom
  timestamp;
- existing enable, disable, permission, concurrency, error, navigation, and
  album-source behavior remains intact.

Run the focused screen test and the mobile TypeScript type check after the
implementation. Run the broader mobile test suite if the focused checks pass.
