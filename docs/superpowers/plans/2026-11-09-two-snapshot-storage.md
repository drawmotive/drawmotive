# Explicit Snapshot Cuts and Retained Journal Plan

> Execute inline with test-driven development. The approved issue 41 contract is the specification.

**Goal:** Keep one current opaque native checkpoint containing its two normalized scenes and bounded history, while preserving the original full journal for recovery.

**Architecture:** Native owns snapshot contents. Storage owns an explicit journal cut, atomic checkpoint/journal/outbox writes, SHA-256 batch identity receipts, and a private atomic retained-journal read. Retired snapshots are replaced rather than retained as receipt payload evidence.

**Constraints:** Fresh `document-v4`, no migration or aliases, unchanged public editor API, serial verification through root npm operations, no root repository edits.

## Task 1: Pin the approved boundary

- [x] Update existing commit fixtures to provide `snapshotAfterJournalId` for nonempty snapshots.
- [x] Add memory/Dexie regressions for a snapshot cut preceding a same-batch journal entry, invalid cuts and rollback, retained ACKed history, immutable reads, and snapshot replacement with old receipt retries.
- [x] Extend retired-database fixtures with the old v3 schema; prove it is never opened or deleted.
- [x] Add real Worker and private platform/replication coverage for `storage.journal`.
- [x] Acquire the serial slot and run the SDK Node suite; inspect intended failures before implementation. RED: 136 tests, 111 pass, 25 expected failures.

## Task 2: Implement the storage authority

- [x] Add checkpoint boundary and retained-journal DTOs in `src/storage/document-store.d.ts`.
- [x] Canonicalize every logical batch field with length-framed bytes and hash using SHA-256 before transactions. Compare receipts using the complete digest and verify referenced immutable journal/outbox records.
- [x] Replace the single current snapshot atomically, retaining only small receipt metadata and complete immutable journal/outbox evidence. Resolve explicit cuts to private journal ordinals.
- [x] Implement equivalent memory and Dexie behavior; append batches retain snapshot/state/cut.
- [x] Add `readRetainedJournal` and wire `storage.journal` through the Worker/platform and private replication adapter.
- [x] Update SDK documentation for native snapshot ownership, cryptographic byte identity and v4 isolation.

## Task 3: Verify and commit

- [x] Run SDK Node tests (136/136), SDK build, storage Worker browser suite (5/5), and real npm12 package audit (187 files, 88 WASM, 87 managed assemblies) serially after obtaining the slot. Full editor browser coverage requires the parent session's new native asset candidate.
- [x] Review touched code for shared invariants, current-only release audit authority and unintended public API changes.
- [x] Prepare the verified changes for the SDK task-branch commit and handoff. The serial slot has been released to native.

## Review Focus

- A snapshot boundary can precede same-batch journal entries; those entries must replay.
- Snapshot cuts cannot reference unknown journal entries or regress behind the current snapshot.
- ACK removes pending membership only; retained journal recovery includes acknowledged records.
- Retrying a retired snapshot batch must not rotate the current snapshot or resurrect outbox membership.
- Missing or changed immutable journal/outbox evidence must reject a receipt retry.
- Archival origin records remain in original recovery order, but never enter causal replay suffixes or the delivery outbox.
- Private portable snapshot export owns decoded bytes and install/archive inputs remain detached across queued dispatch.
