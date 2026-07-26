import { describe, expect, it } from 'vitest';
import { buildInviteUrl } from '../../src/lib/utils/inviteUrlBuilder';

describe('Invitation URL Builder Helper Unit Tests', () => {
  const groupId = 'grp_test_999';
  const invKeyHex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

  it('builds a fully qualified URL for Localhost development environment', () => {
    const url = buildInviteUrl({
      groupId,
      invKeyHex,
      baseUrl: 'http://localhost:5173/',
    });

    expect(url).toBe(`http://localhost:5173/#/join?groupId=${groupId}&invKey=${invKeyHex}`);
    expect(url).toContain('http://localhost:5173/');
    expect(url).toContain('#/join?groupId=grp_test_999&invKey=a1b2c3d4');
  });

  it('builds a fully qualified URL for GitHub Pages with nested path', () => {
    const url = buildInviteUrl({
      groupId,
      invKeyHex,
      baseUrl: 'https://thegandabherunda.github.io/SliceWyse',
    });

    expect(url).toBe(
      `https://thegandabherunda.github.io/SliceWyse/#/join?groupId=${groupId}&invKey=${invKeyHex}`
    );
    expect(url).toContain('https://thegandabherunda.github.io/SliceWyse/#/join');
  });

  it('builds a fully qualified URL for Custom Domain deployments', () => {
    const url = buildInviteUrl({
      groupId,
      invKeyHex,
      baseUrl: 'https://app.slicewyse.com/dashboard/',
    });

    expect(url).toBe(
      `https://app.slicewyse.com/dashboard/#/join?groupId=${groupId}&invKey=${invKeyHex}`
    );
  });

  it('includes optional relay parameter when provided', () => {
    const url = buildInviteUrl({
      groupId,
      invKeyHex,
      relayUrl: 'wss://relay.damus.io',
      baseUrl: 'http://localhost:5173',
    });

    expect(url).toContain('&relay=wss%3A%2F%2Frelay.damus.io');
  });
});
