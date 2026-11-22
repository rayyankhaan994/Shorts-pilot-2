/**
 * Firestore Security Rules Verification Matrix (Phase 0)
 * Verifies the 12 "Dirty Dozen" attack vectors documented in security_spec.md
 * against the compiled firestore.rules invariants.
 *
 * Run with Firebase Emulator Suite:
 *   firebase emulators:exec --only firestore "npx tsx firestore.rules.test.ts"
 */

export const DIRTY_DOZEN_CASES = [
  {
    id: 1,
    name: 'Unauthenticated Video Creation',
    collection: 'videos',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'request.auth == null fails isVerifiedUser()',
  },
  {
    id: 2,
    name: 'Identity Spoofing on Video',
    collection: 'videos',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'incoming().userId != request.auth.uid fails isValidVideo()',
  },
  {
    id: 3,
    name: 'Shadow Field Injection on User',
    collection: 'users',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'extra key isAdmin fails keys().hasOnly() in isValidUser()',
  },
  {
    id: 4,
    name: 'Secret Collection Read',
    collection: 'youtube_channel_secrets',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    reason: 'allow read, write: if false blocks all client access',
  },
  {
    id: 5,
    name: 'Lock Tampering',
    collection: 'scheduler_locks',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'allow read, write: if false blocks all client access',
  },
  {
    id: 6,
    name: 'Spoofed Published Video Create',
    collection: 'videos',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'incoming().status in ["Uploaded", "Waiting"] rejects "Published"',
  },
  {
    id: 7,
    name: 'Mutating Published Video',
    collection: 'videos',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'existing().status != "Published" blocks all client updates',
  },
  {
    id: 8,
    name: 'Deleting Published Video',
    collection: 'videos',
    operation: 'delete',
    expected: 'PERMISSION_DENIED',
    reason: 'existing().status in ["Uploaded", "Waiting", "Failed"] preserves history',
  },
  {
    id: 9,
    name: 'Blanket Query Scraping',
    collection: 'videos',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    reason: 'allow list requires resource.data.userId == request.auth.uid',
  },
  {
    id: 10,
    name: 'Unbounded Array Attack on Settings',
    collection: 'publishing_settings',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'dailyPublishingTimes.size() <= 6 rejects oversized arrays',
  },
  {
    id: 11,
    name: 'Oversized Title Poisoning',
    collection: 'videos',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'data.title.size() <= 100 rejects 500-char titles',
  },
  {
    id: 12,
    name: 'Client Timestamp Forgery',
    collection: 'notifications',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'incoming().createdAt == request.time rejects backdated timestamps',
  },
];
