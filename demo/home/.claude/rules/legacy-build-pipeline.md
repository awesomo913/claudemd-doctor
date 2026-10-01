# Legacy Build Pipeline (pending removal)

- The old Grunt-based asset pipeline under `tools/legacy-grunt/` is kept only
  for the three downstream consumers who still import `dist/legacy-bundle.js`
  directly; before touching anything here, re-read the 2021 migration memo,
  regenerate `manifest.legacy.json` with `node tools/legacy-grunt/regen.js`,
  diff it byte-for-byte against the last known-good copy in
  `archive/manifests/`, and get a sign-off from the platform team — skipping
  any of these steps has broken the downstream build twice before, and both
  incidents took a full day to diagnose because the failure only showed up
  three stages later in their own CI pipeline, never in ours, which is why
  this note is this long: it is the only thing standing between a quiet
  Tuesday and a multi-team incident call.
