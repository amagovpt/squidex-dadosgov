/**
 * Tiny shared flag for the gateway readiness, kept in its own module to avoid a
 * circular import between `app.ts` and the health-check controller.
 */
let ready = false;

export function setGatewayReady(value: boolean): void {
  ready = value;
}

export function isGatewayReady(): boolean {
  return ready;
}
