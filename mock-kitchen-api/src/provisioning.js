/**
 * Builds the JSON string encoded in the provisioning QR. Field names match
 * what the Android app's ProvisioningPayload reads.
 */
export function provisioningPayload({ baseUrl, token, kitchenId, printerIdentifier, kitchenName }) {
  return JSON.stringify({
    v: 1,
    baseUrl,
    printerToken: token,
    kitchenId,
    printerIdentifier,
    kitchenName,
  });
}
