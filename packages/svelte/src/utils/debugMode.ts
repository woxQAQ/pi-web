export function readInitialDebugMode(
  available: boolean,
  storageValue: string | null,
  search: string,
): boolean {
  if (!available) return false;
  if (storageValue === "true" || storageValue === "false") {
    return storageValue === "true";
  }
  return new URLSearchParams(search).get("debug") === "1";
}
