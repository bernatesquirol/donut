import { startRouter, type Route } from "./router";

/**
 * Three surfaces, three bundles:
 *
 *   /         the game itself (pixi), playing the local working copy
 *   /creator  authoring (preact), writes documents
 *   /view     a published document (preact chrome around the same pixi scene)
 *
 * Each route is a dynamic import, so visiting the game never downloads the
 * creator.
 */
const routes: Route[] = [
  {
    path: "/creator",
    load: () => import("./creator/mount"),
  },
  {
    path: "/view",
    load: () => import("./viewer/mount"),
  },
];

const game: Route = { path: "/", load: () => import("./game/mount") };

const root = document.getElementById("app")!;
startRouter(root, routes, game);
