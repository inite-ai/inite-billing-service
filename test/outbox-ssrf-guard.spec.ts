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

    // `new URL('http://[::ffff:127.0.0.1]/').hostname` is `[::ffff:7f00:1]`:
    // the URL parser rewrites the dotted tail into hex, so the guard sees the
    // hex spelling. It used to recognise only the dotted one.
    it.each([
      ['::ffff:7f00:1', 'loopback, IPv4-mapped in hex'],
      ['::ffff:a9fe:a9fe', 'metadata service, IPv4-mapped in hex'],
      ['0:0:0:0:0:ffff:0a00:0001', '10.0.0.1, mapped, fully written'],
      ['::ffff:ac11:2', '172.17.0.2, the docker bridge'],
      ['::7f00:1', 'loopback, IPv4-compatible'],
      ['::127.0.0.1', 'loopback, IPv4-compatible dotted'],
      ['::ffff:0:7f00:1', 'loopback, IPv4-translated'],
      ['64:ff9b::a9fe:a9fe', 'metadata service through NAT64'],
      ['64:ff9b::169.254.169.254', 'metadata service through NAT64, dotted'],
      ['64:ff9b:1::1', 'local-use NAT64'],
      ['2002:7f00:1::1', 'loopback through 6to4'],
      ['2001:0:4136:e378:8000:63bf:3fff:fdd2', 'Teredo'],
      ['fec0::1', 'site-local'],
      ['2001:db8::1', 'documentation'],
      ['fe80::1%eth0', 'link-local with a zone'],
    ])('flags %s (%s) as private', (ip) => expect(isPrivateAddress(ip)).toBe(true));

    it.each(['::ffff:808:808', '64:ff9b::808:808', '2002:808:808::1'])(
      'judges an embedded public IPv4 as public: %s',
      (ip) => expect(isPrivateAddress(ip)).toBe(false),
    );
  });

  describe('assertPublicUrl', () => {
    it('rejects a literal metadata IP without any DNS', async () => {
      const r = await assertPublicUrl('http://169.254.169.254/latest/meta-data/');
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('private_ip');
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it.each([
      'http://[::ffff:127.0.0.1]:3000/internal',
      'http://[::ffff:169.254.169.254]/latest/meta-data/',
      'http://[::ffff:a9fe:a9fe]/latest/meta-data/',
      'http://[0:0:0:0:0:ffff:7f00:1]/',
      'http://[::127.0.0.1]/',
    ])('rejects the IPv4-mapped literal %s without any DNS', async (url) => {
      const r = await assertPublicUrl(url);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('private_ip');
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it('rejects a hostname that resolves to an IPv4-mapped private address', async () => {
      mockLookup.mockResolvedValue([{ address: '::ffff:a9fe:a9fe', family: 6 }]);
      const r = await assertPublicUrl('https://rebind.example.com/mcp');
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('resolves_to_private');
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
