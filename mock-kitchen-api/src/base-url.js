/**
 * Chooses the base URL advertised in the provisioning QR.
 *
 * `override` (the PUBLIC_BASE_URL env var) wins and is used as given (only
 * surrounding whitespace is trimmed), which is
 * how you pick the right interface on a machine with VPN or virtual adapters.
 * A blank override is treated as unset. Otherwise the detected LAN address and
 * the actual listening port are used.
 */
export function resolveBaseUrl({ override, lanAddress, port }) {
  const trimmed = typeof override === 'string' ? override.trim() : '';
  if (trimmed !== '') return trimmed;
  return `http://${lanAddress}:${port}`;
}
