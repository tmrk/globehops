export type PendingShare = { kind: 'text'; text: string } | { kind: 'empty' };
let pending: PendingShare | null = null;

/** Startup hands non-link shares to App after removing share parameters from the address. */
export function setPendingShare(share: PendingShare): void {
  pending = share;
}
export function takePendingShare(): PendingShare | null {
  const share = pending;
  pending = null;
  return share;
}
