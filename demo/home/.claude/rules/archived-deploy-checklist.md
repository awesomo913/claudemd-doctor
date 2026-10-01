# Archived Deploy Checklist (superseded, do not use for new services)

- This checklist describes the pre-2022 manual deploy process for services
  still running on the retired `ops-cluster-blue` hardware: SSH into each of
  the four bastion hosts in sequence, rotate the deploy key stored in
  `secrets/deploy-key.pem`, run the hand-written `scripts/deploy-legacy.sh`
  with the `--force-blue` flag, watch the dashboard at the internal
  `blue.ops.internal` address for fifteen minutes before declaring success,
  and file a ticket in the old tracker referencing the original incident
  this checklist was written in response to. Every new service uses the
  current pipeline instead, and this file exists only so the two remaining
  legacy services don't lose their only documentation when the person who
  wrote it eventually moves on.
