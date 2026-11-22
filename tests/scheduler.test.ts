import assert from 'node:assert/strict';
import {
  decryptSecret,
  encryptSecret,
  signOAuthState,
  signStreamToken,
  verifyOAuthState,
  verifyStreamToken,
} from '../backend/lib/crypto.ts';
import {
  combineYouTubeDescription,
  computeUpcomingSlots,
} from '../backend/lib/timezone.ts';

const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function run() {
  // 1. Web Crypto AES-256-GCM encryption roundtrip
  const sampleToken = '1//0gTestRefreshTokenPayloadXYZ';
  const encrypted = await encryptSecret(sampleToken, TEST_KEY);
  assert.notEqual(encrypted, sampleToken);
  assert.equal(await decryptSecret(encrypted, TEST_KEY), sampleToken);

  // 2. OAuth HMAC-SHA256 state verification & tamper rejection
  const state = await signOAuthState(
    {
      uid: 'user_123',
      originUrl: 'https://shortspilot.onrender.com',
      redirectUri: 'https://shortspilot.onrender.com/api/youtube/callback',
    },
    TEST_KEY
  );
  const verified = await verifyOAuthState(state, TEST_KEY);
  assert.equal(verified.uid, 'user_123');
  await assert.rejects(
    () => verifyOAuthState(`${state}tampered`, TEST_KEY),
    /signature/i
  );

  // 3. Stream token signing & verification
  const streamToken = await signStreamToken(
    { uid: 'user_123', key: 'users/user_123/videos/vid_1/original.mp4' },
    TEST_KEY
  );
  const verifiedStream = await verifyStreamToken(streamToken, TEST_KEY);
  assert.equal(verifiedStream.uid, 'user_123');
  assert.equal(verifiedStream.key, 'users/user_123/videos/vid_1/original.mp4');

  // 4. Scenario A: 0 scheduled, 6 waiting -> computes 6 future Asia/Kolkata slots
  const defaultTimes = ['09:00', '12:00', '15:00', '18:00', '21:00', '23:00'];
  const now = new Date('2026-11-22T02:00:00.000Z'); // 07:30 AM IST
  const sixSlots = computeUpcomingSlots({
    timeZone: 'Asia/Kolkata',
    dailyPublishingTimes: defaultTimes,
    existingScheduledIsos: [],
    slotsNeeded: 6,
    now,
  });
  assert.equal(sixSlots.length, 6);
  // First slot should be 09:00 AM IST = 03:30 UTC
  assert.equal(sixSlots[0], '2026-11-22T03:30:00.000Z');
  // Last slot should be 11:00 PM IST = 17:30 UTC
  assert.equal(sixSlots[5], '2026-11-22T17:30:00.000Z');

  // 5. Scenario C & H: Existing scheduled slots are preserved and skipped
  const remainingSlots = computeUpcomingSlots({
    timeZone: 'Asia/Kolkata',
    dailyPublishingTimes: defaultTimes,
    existingScheduledIsos: ['2026-11-22T03:30:00.000Z', '2026-11-22T06:30:00.000Z'],
    slotsNeeded: 4,
    now,
  });
  assert.equal(remainingSlots.length, 4);
  assert.equal(remainingSlots[0], '2026-11-22T09:30:00.000Z'); // 3:00 PM IST

  // 6. YouTube description + hashtag combination within 5000 chars
  const combined = combineYouTubeDescription('Amazing videos every day!', '#shorts #viral');
  assert.equal(combined, 'Amazing videos every day!\n\n#shorts #viral');
  assert.ok(combineYouTubeDescription('a'.repeat(4995), '#shorts').length <= 5000);

  console.log(
    'All ShortsPilot core unit tests passed (Web Crypto AES-256-GCM, HMAC OAuth/stream state, Asia/Kolkata 6-slot scheduler).'
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
