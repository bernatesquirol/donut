import { startRouter, type Route } from "./router";

/**
 * Four surfaces, four bundles:
 *
 *   /         the host's console (pixi): the keyboard, the clock, the answers
 *   /creator  authoring (preact), writes documents
 *   /view     a published document (preact chrome around the same pixi scene)
 *   /play     one contestant's screen, following the host's live room
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
  {
    path: "/play",
    load: () => import("./player/mount"),
  },
];

const game: Route = { path: "/", load: () => import("./game/mount") };

const root = document.getElementById("app")!;
startRouter(root, routes, game);
