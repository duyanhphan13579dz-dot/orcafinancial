export function isDepthEventContiguous(
  previousUpdateId: number,
  event: { U?: number; u?: number },
) {
  if (!Number.isFinite(previousUpdateId) || event.U == null || event.u == null || event.u <= 0) return false;
  if (event.u <= previousUpdateId) return true;
  return event.U <= previousUpdateId + 1 && event.u >= previousUpdateId + 1;
}
