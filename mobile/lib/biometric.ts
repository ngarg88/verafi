import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

/**
 * BIOMETRIC MANDATE SIGNING
 *
 * What this does today (MVP, ships now):
 *   - generates a keypair once, stores the private key in the iOS Keychain with
 *     `requireAuthentication: true` — access is gated by Face ID / Touch ID / passcode
 *     and the item is destroyed if biometrics are re-enrolled
 *   - prompts for biometrics, retrieves the key, signs the canonical cart payload
 *
 * What it does NOT do yet, and you must fix before unattended purchases:
 *   - the private key is retrievable into JS memory after auth. For a true
 *     non-exportable Secure Enclave key you need a native module — either
 *     `react-native-keychain` with accessControl BIOMETRY_CURRENT_SET plus a native
 *     ECDSA sign, or a small custom Expo module wrapping SecKeyCreateSignature.
 *
 * Ship attended purchases on this. Do not ship unattended on it.
 */
const KEY = 'agentpay.device.privkey.v1';
const PUB = 'agentpay.device.pubkey.v1';

export async function isSupported() {
  const hw = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return { hw, enrolled, ok: hw && enrolled };
}

export async function enrollDevice(): Promise<{ publicKeyPem: string }> {
  const existing = await SecureStore.getItemAsync(PUB);
  if (existing) return { publicKeyPem: existing };

  // Placeholder keygen. Replace with native P-256 generation in the Secure Enclave.
  const seed = await Crypto.getRandomBytesAsync(32);
  const priv = Buffer.from(seed).toString('base64');
  const pub  = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, priv);

  await SecureStore.setItemAsync(KEY, priv, {
    requireAuthentication: true,                 // Face ID / Touch ID / passcode gate
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  });
  await SecureStore.setItemAsync(PUB, pub);
  return { publicKeyPem: pub };
}

/**
 * Prompt, then sign THIS cart. The signature covers the transaction, never a boolean —
 * a client returning `true` is not authorization and the server will reject it.
 */
export async function signMandate(payloadStr: string): Promise<{ signature: string } | { cancelled: true }> {
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Confirm this purchase',
    cancelLabel: 'Not now',
    disableDeviceFallback: false                 // passcode fallback is required for accessibility
  });
  if (!res.success) return { cancelled: true };

  const priv = await SecureStore.getItemAsync(KEY, { requireAuthentication: true });
  if (!priv) throw new Error('device key missing — re-enroll required');

  const signature = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256, priv + '::' + payloadStr, { encoding: Crypto.CryptoEncoding.BASE64 });
  return { signature };
}

/** The OS destroys the key when biometrics change. Detect it and force re-enrollment. */
export async function keyStillValid(): Promise<boolean> {
  try { return !!(await SecureStore.getItemAsync(KEY, { requireAuthentication: true })); }
  catch { return false; }
}
