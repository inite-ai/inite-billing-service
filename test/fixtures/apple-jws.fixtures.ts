import { X509Certificate } from 'crypto';
import { CompactSign, importPKCS8 } from 'jose';

/**
 * A throwaway EC P-256 certificate chain (root → intermediate → leaf) generated
 * with openssl solely for exercising Apple JWS verification. It lets tests build
 * genuinely-signed JWS tokens that anchor to a TEST root (passed via
 * `verifyAppleSignedPayload({ roots: [TEST_ROOT] })`) — never the pinned Apple
 * root — so the crypto path is covered without shelling out at test time.
 *
 * These are NOT Apple certificates and grant no trust against the real root.
 */

export const LEAF_DER_B64 =
  'MIIB1jCCAXygAwIBAgIUUkKRYc2xod5yMPlnOBFF7I8xc4MwCgYIKoZIzj0EAwIwPjELMAkGA1UEBhMCVVMxDTALBgNVBAoMBFRlc3QxIDAeBgNVBAMMF1Rlc3QgQXBwbGUgSW50ZXJtZWRpYXRlMB4XDTI2MDgwODIwNTU1MFoXDTI4MTExMDIwNTU1MFowNjELMAkGA1UEBhMCVVMxDTALBgNVBAoMBFRlc3QxGDAWBgNVBAMMD1Rlc3QgQXBwbGUgTGVhZjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABI2hc1ZKlF/1q7fXnO0hhwxCwmGri/JdyP6aA12vuSjRYwVWOdmsUWIVsOIdLWF8hUHyHANFrnn8d1I+Zawq/PSjYDBeMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMB0GA1UdDgQWBBRCe1em0Alw75CLRRPr0IXTJIA3ZzAfBgNVHSMEGDAWgBRQaJXlXS/RT1s/80hjzSms0NiOJjAKBggqhkjOPQQDAgNIADBFAiA4irnuvB5g7LMBvE4z/QX6/YaFf7cf73Zu+W+/MPtQrQIhAKOgotNYmrlo4hD23cziK10Elon1Fxgv748VabznBn4Y';

export const INT_DER_B64 =
  'MIIB2TCCAX+gAwIBAgIUSgVsTzwjiTrslmu/SZCr40N2j/swCgYIKoZIzj0EAwIwNjELMAkGA1UEBhMCVVMxDTALBgNVBAoMBFRlc3QxGDAWBgNVBAMMD1Rlc3QgQXBwbGUgUm9vdDAeFw0yNjA4MDgyMDU1NTBaFw0zMTA4MDcyMDU1NTBaMD4xCzAJBgNVBAYTAlVTMQ0wCwYDVQQKDARUZXN0MSAwHgYDVQQDDBdUZXN0IEFwcGxlIEludGVybWVkaWF0ZTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABFclC/2jmfkK08nR+UD809hi1985oTs/AbCGyq/hviLQyxZxwRaR+IzoxJa0RGUv6OsgVbyepkL0wbPfJhpCfcujYzBhMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBRQaJXlXS/RT1s/80hjzSms0NiOJjAfBgNVHSMEGDAWgBSVvWAMjb7s+pl31riAEOk6DJAihzAKBggqhkjOPQQDAgNIADBFAiAS7J1phGarcKRUd44YGVC2N+6snjM/rbp6v3AAmz9srQIhAMiqrh7dyM0FxL5ZIE7T67IPfjREIWdk0v/+jFGdfTG2';

export const ROOT_DER_B64 =
  'MIIB0TCCAXegAwIBAgIUJ7JsbWZTLygb9Yta8U0unhZzglcwCgYIKoZIzj0EAwIwNjELMAkGA1UEBhMCVVMxDTALBgNVBAoMBFRlc3QxGDAWBgNVBAMMD1Rlc3QgQXBwbGUgUm9vdDAeFw0yNjA4MDgyMDU1NTBaFw0zNjA4MDUyMDU1NTBaMDYxCzAJBgNVBAYTAlVTMQ0wCwYDVQQKDARUZXN0MRgwFgYDVQQDDA9UZXN0IEFwcGxlIFJvb3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATm5dYG6tVSpqvjyiPXZfU6Vwy0nWaCGpfZ4RyWm6aqJZocDNcHYODNQNbWqfXgv9PabEkLDCUSaPw6oKq4fTkEo2MwYTAdBgNVHQ4EFgQUlb1gDI2+7PqZd9a4gBDpOgyQIocwHwYDVR0jBBgwFoAUlb1gDI2+7PqZd9a4gBDpOgyQIocwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIgWYf/IPx3/sua/YMDSq0sAcx/MCI5rhuvFoFGp+gB99cCIQCd8Pjz0j0CKv0KAnOAldByKcGcdIicje0zv0/AMxCneA==';

const LEAF_PRIVATE_KEY_PKCS8 = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgnFMJiz6aytRBq+dW
ye5piWxDmTNudW1qbros1Y4HEmihRANCAASNoXNWSpRf9au315ztIYcMQsJhq4vy
Xcj+mgNdr7ko0WMFVjnZrFFiFbDiHS1hfIVB8hwDRa55/HdSPmWsKvz0
-----END PRIVATE KEY-----`;

export const TEST_ROOT = new X509Certificate(Buffer.from(ROOT_DER_B64, 'base64'));

/**
 * Build a compact ES256 JWS over `payload`, signed by the test leaf key, with a
 * configurable x5c chain (defaults to Apple's leaf+intermediate presentation).
 */
export async function signAppleJws(
  payload: Record<string, any>,
  x5c: string[] = [LEAF_DER_B64, INT_DER_B64],
): Promise<string> {
  const key = await importPKCS8(LEAF_PRIVATE_KEY_PKCS8, 'ES256');
  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: 'ES256', x5c })
    .sign(key);
}
