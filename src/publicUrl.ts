/** Prefix a root-absolute public path with Vite's base (so GitHub Pages project sites resolve). */
export function publicUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return base + path;
}
