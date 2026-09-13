/**
 * Minimal path router.
 *
 * Paths are written base-relative ("/creator"); `link` prefixes them with
 * Vite's configured base and `normalisePath` strips it again, so the same code
 * works at the dev root and under a GitHub Pages project path.
 */
export interface Route {
  path: string;
  load: () => Promise<{ mount: (root: HTMLElement) => void | Promise<void> }>;
}

/**
 * Base without its trailing slash. Empty unless the site was built for a
 * subpath — see `BASE_PATH` in `vite.config.ts`.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, "");

/** Turn a base-relative path into an href. */
export function link(path: string): string {
  return BASE + path;
}

/**
 * A link worth copying: the same path with this origin on the front. Anything
 * shown to be pasted elsewhere needs one.
 */
export function absoluteLink(path: string): string {
  return new URL(link(path), window.location.origin).href;
}

export function normalisePath(pathname: string): string {
  let path = pathname;
  if (BASE && path.startsWith(BASE)) path = path.slice(BASE.length);
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export async function startRouter(
  root: HTMLElement,
  routes: Route[],
  fallback: Route,
): Promise<void> {
  const path = normalisePath(window.location.pathname);
  const route = routes.find((r) => r.path === path) ?? fallback;
  const mod = await route.load();
  await mod.mount(root);
}

/** Navigate without a full reload. */
export function navigate(path: string): void {
  window.history.pushState({}, "", link(path));
  window.location.reload();
}
