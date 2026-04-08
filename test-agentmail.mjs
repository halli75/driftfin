#!/usr/bin/env node

import assert from 'node:assert/strict';
import { __test__ } from './agentmail-client.mjs';

const {
  extractLinks,
  extractVerification,
  findOtp,
  looksLikeVerificationText,
  scoreMessage,
  shouldPreferCandidate,
} = __test__;

function message({
  subject = '',
  body = '',
  from = '',
  timestamp = '2026-04-08T12:00:00.000Z',
} = {}) {
  return {
    subject,
    extractedText: body,
    from,
    timestamp,
  };
}

function run() {
  assert.deepEqual(
    extractLinks('Verify here https://example.com/verify?token=abc123 and ignore https://example.com/help'),
    ['https://example.com/verify?token=abc123', 'https://example.com/help'],
    'extractLinks should return every HTTP(S) URL in order',
  );

  assert.equal(
    findOtp('Your verification code is 654321.'),
    '654321',
    'findOtp should extract keyword-scoped verification codes',
  );

  assert.equal(
    findOtp('Use 123456 to sign in to your account.'),
    '123456',
    'findOtp should allow a strict six-digit fallback in verification-themed messages',
  );

  assert.equal(
    findOtp('Ship to 94107. Call extension 1234 before 20260408.'),
    '',
    'findOtp should not treat arbitrary numeric text as an OTP',
  );

  assert.equal(
    looksLikeVerificationText('Please verify your email to continue'),
    true,
    'verification helper should detect verification-themed text',
  );

  assert.equal(
    looksLikeVerificationText('Weekly product roundup and hiring updates'),
    false,
    'verification helper should ignore unrelated mail',
  );

  assert.deepEqual(
    extractVerification(message({
      body: 'Click https://example.com/verify?token=abc123 or use code 654321.',
    })),
    { kind: 'link', value: 'https://example.com/verify?token=abc123' },
    'extractVerification should prefer magic links over OTPs',
  );

  const matchedMessage = message({
    subject: 'OpenAI verification code',
    body: 'Use 654321 to verify your sign in to OpenAI Careers.',
    from: 'OpenAI Careers <careers@openai.com>',
  });
  const genericMessage = message({
    subject: 'Weekly digest',
    body: 'Use 654321 to track package 94107.',
    from: 'Digest <digest@example.com>',
  });

  assert.ok(
    scoreMessage(matchedMessage, {
      senderHint: 'openai.com',
      subjectHint: 'verification',
      company: 'OpenAI',
      platform: 'Ashby',
    }) > scoreMessage(genericMessage, {}),
    'scoreMessage should reward matching hints and verification content',
  );

  assert.equal(
    shouldPreferCandidate(
      { score: 1, received_at: '2026-04-08T12:05:00.000Z' },
      { score: 15, received_at: '2026-04-08T12:00:00.000Z' },
    ),
    false,
    'candidate selection should not prefer a newer low-score message',
  );

  assert.equal(
    shouldPreferCandidate(
      { score: 12, received_at: '2026-04-08T12:05:00.000Z' },
      { score: 12, received_at: '2026-04-08T12:00:00.000Z' },
    ),
    true,
    'candidate selection should use recency as a tie-breaker',
  );

  console.log('agentmail regression tests passed');
}

run();
