# ShortsPilot Security Rules Specification (Phase 0)

## 1. Data Invariants

1. **Identity Isolation**: Every user document in `users`, `youtube_channels`, `videos`, `publishing_settings`, `publishing_jobs`, `publishing_history`, and `notifications` MUST belong to `request.auth.uid`.
2. **Secret Isolation**: `youtube_channel_secrets` and `scheduler_locks` are strictly server-only (`allow read, write: if false;` on client SDK).
3. **Immutable Publishing History**: `publishing_history` records cannot be updated by clients, and `videos` with `status == 'Published'` or `status == 'Scheduled'` cannot have their metadata silently overwritten or be deleted by standard client mutations.
4. **No Self-Forcing Published Status**: Clients creating a `videos` record MUST start in `'Uploaded'` or `'Waiting'` with an empty `youtubeVideoId` and `retryCount == 0`.
5. **Verified Auth & Strict Timestamps**: Every client write enforces `request.auth != null`, `request.auth.token.email_verified == true` (when email is present), `createdAt == request.time`, and `updatedAt == request.time`.
6. **Strict Schema Enforcement**: Every `create` uses `keys().hasAll(...)` + `keys().hasOnly(...)` and every `update` uses `diff(existing()).affectedKeys().hasOnly(...)` combined with `isValid[Entity](incoming())`.

## 2. The "Dirty Dozen" Attack Payloads

1. **Unauthenticated Video Creation**: `create /videos/v1` with `request.auth == null` -> `PERMISSION_DENIED`.
2. **Identity Spoofing on Video**: Authenticated as `userA`, `create /videos/v1` with `userId: "userB"` -> `PERMISSION_DENIED`.
3. **Shadow Field Injection on User**: `create /users/userA` with extra ghost field `isAdmin: true` -> `PERMISSION_DENIED`.
4. **Secret Collection Read**: Authenticated as `userA`, `get /youtube_channel_secrets/userA` -> `PERMISSION_DENIED`.
5. **Lock Tampering**: Authenticated as `userA`, `create /scheduler_locks/userA` -> `PERMISSION_DENIED`.
6. **Spoofed Published Video Create**: `create /videos/v1` with `status: "Published"` and fake `youtubeVideoId: "abc"` -> `PERMISSION_DENIED`.
7. **Mutating Published Video**: `update /videos/v1` where existing `status == "Published"` -> `PERMISSION_DENIED`.
8. **Deleting Published Video**: `delete /videos/v1` where existing `status == "Published"` -> `PERMISSION_DENIED`.
9. **Blanket Query Scraping**: `list /videos` without `where('userId', '==', auth.uid)` -> `PERMISSION_DENIED`.
10. **Unbounded Array Attack on Settings**: `update /publishing_settings/userA` with `dailyPublishingTimes` of 50 entries -> `PERMISSION_DENIED`.
11. **Oversized Title Poisoning**: `update /videos/v1` with `title` of 500 chars -> `PERMISSION_DENIED`.
12. **Client Timestamp Forgery**: `create /notifications/n1` with backdated `createdAt` (`!= request.time`) -> `PERMISSION_DENIED`.
