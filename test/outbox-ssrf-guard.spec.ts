jest.mock('dns/promises', () => ({ lookup: jest.fn() }));
import { lookup } from 'dns/promises';
import { isPrivateIPv4, isPrivateAddress, assertPublicUrl } from '../src/workers/ssrf-guard';

const mockLookup = lookup as unknown as jest.Mock;

/**
 * The outbox SSRF guard must reject webhook URLs that reach internal targets —
 * including a public hostname that RESOLVES to a private IP (DNS rebinding) and
 * the cloud metadata endpoint. The old check only string-matched the hostname.
 */
describe('SSRF guard', () => {
  afterEach(() => mockLookup.mockReset());

  describe('isPrivateIPv4', () => {
    it.each([
      '10.0.0.1',
      '127.0.0.1',
      '169.254.169.254', // cloud metadata
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1', // CGNAT
      '0.0.0.0',
      '224.0.0.1', // multicast
      '255.255.255.255',
    ])('flags %s as private', (ip) => expect(isPrivateIPv4(ip)).toBe(true));

    it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1'])(
      'allows public %s',
      (ip) => expect(isPrivateIPv4(ip)).toBe(false),
    );

    it('treats malformed input as unsafe', () => {
      expect(isPrivateIPv4('999.1.1.1')).toBe(true);
      expect(isPrivateIPv4('nonsense')).toBe(true);
    });
  });

  describe('isPrivateAddress (IPv6)', () => {
    it.each(['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', 'ff02::1'])(
      'flags %s as private',
      (ip) => expect(isPrivateAddress(ip)).toBe(true),
    );
    it.each(['2606:4700:4700::1111', '2001:4860:4860::8888'])('allows public %s', (ip) =>
      expect(isPrivateAddress(ip)).toBe(false),
    );
  });

  describe('assertPublicUrl', () => {
    it('rejects a literal metadata IP without any DNS', async () => {
      const r = await assertPublicUrl('http://169.254.169.254/latest/meta-data/');
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('private_ip');
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it('rejects non-http(s) protocols', async () => {
      expect((await assertPublicUrl('ftp://example.com')).ok).toBe(false);
      expect((await assertPublicUrl('file:///etc/passwd')).ok).toBe(false);
    });

    it('rejects localhost / .local / metadata host by name', async () => {
      expect((await assertPublicUrl('http://localhost:9000')).ok).toBe(false);
      expect((await assertPublicUrl('http://foo.local')).ok).toBe(false);
      expect((await assertPublicUrl('http://metadata.google.internal')).ok).toBe(false);
    });

    it('rejects a public hostname that RESOLVES to a private IP (rebinding)', async () => {
      mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      const r = await assertPublicUrl('https://evil.example.com/webhook');
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('resolves_to_private');
    });

    it('rejects when ANY resolved address is private (mixed answers)', async () => {
      mockLookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ]);
      expect((await assertPublicUrl('https://mixed.example.com')).ok).toBe(false);
    });

    it('allows a hostname that resolves to public addresses', async () => {
      mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      const r = await assertPublicUrl('https://example.com/webhook');
      expect(r.ok).toBe(true);
      expect(r.addresses).toEqual(['93.184.216.34']);
    });

    it('fails closed when DNS resolution throws', async () => {
      mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
      expect((await assertPublicUrl('https://nope.example.com')).ok).toBe(false);
    });
  });
});
