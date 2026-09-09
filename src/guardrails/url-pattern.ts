// A small glob-style path matcher: "*" matches exactly one path segment.
// Shared by the safety policy (route allowlisting) and replay (business
// outcome / checkpoint detection) -- both need "does this URL match this
// declared shape" and should use one implementation, not two copies that
// could quietly diverge.
export function matchesUrlPattern(url: string, pattern: string): boolean {
  const pathname = new URL(url).pathname;
  const patternPath = pattern.startsWith("http") ? new URL(pattern).pathname : pattern;
  const regex = new RegExp(
    "^" +
      patternPath
        .split("*")
        .map((seg) => seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]+") +
      "$"
  );
  return regex.test(pathname);
}
