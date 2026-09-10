# blank-game

A blank game to start new games from: a PixiJS canvas, a Preact authoring tool
for the content it renders, versioned storage for that content, and a GitHub
Pages deploy. None of it does anything yet — that is the point.

It was cut down from a working game, so the seams are the ones a real game
turned out to need, not the ones that looked tidy on a whiteboard.

```
npm install
npm run dev      # http://localhost:8080
npm run build    # lint + tsc + vite build, exactly what CI runs
```

## The three surfaces

| URL        | What it is                                 | Built with        |
| ---------- | ------------------------------------------ | ----------------- |
| `/`        | the game, full-screen                      | PixiJS            |
| `/creator` | authoring: edit a document, save, publish  | Preact            |
| `/view`    | one published document, from a link        | Preact + PixiJS   |

Each is a dynamic import, so opening the game never downloads the creator.
`/` plays the local working copy; `/view?id=…` resolves a *published* document
from shared storage, which is what you send to someone else.

## The one idea

A **document** describes the content; the **scene** renders it. Nothing else.

```
src/doc/types.ts     GameDoc — the authored content
src/game/Scene.ts    draws a GameDoc, one frame at a time
```

The placeholder document is a bag of labelled tiles at normalised positions.
The placeholder scene draws them bobbing, and flashes one when you tap it —
enough to prove the ticker, the layout and hit-testing all work.

Everything else drives the scene through four members only:

```ts
scene.setDoc(doc); // content in
scene.resize(w, h); // the host owns the size; the scene never reads the window
scene.update(deltaMS); // one tick
scene.onTap = (x, y, item) => {}; // pointer out, in 0..1 document coordinates
```

Which is why the creator can embed the real scene as its live preview instead
of faking one, and why replacing `Scene.ts` needs no changes anywhere else.

## Starting a new game

1. **Rename.** `package.json` name, `<title>` in `index.html`, `base` in
   `vite.config.ts` (must match the repo name or Pages 404s on every asset),
   and `persistence.prefix` in `src/config.ts` (or two games share one
   catalogue).
2. **Rewrite `src/doc/types.ts`.** Make `GameDoc` your content. Keep
   `parseDoc` forgiving — it reads documents written by older builds.
3. **Rewrite `src/game/Scene.ts`.** Keep the four members above.
4. **Rebuild the creator's `Editor.tsx`** around the new document. `Preview`,
   `DocPicker`, save/publish and the toolbar stay as they are.
5. Delete what you don't need. `src/ui/` in particular is a library, not a
   dependency — see below.

## What's in the box

```
src/
  main.ts            route table
  router.ts          path router that survives the Pages base path
  config.ts          every tunable, overridable from the query string
  theme.ts           palette + metrics for the pixi side
  screens.css        the same palette for the DOM screens
  doc/
    types.ts         GameDoc, parseDoc, starterDoc
    storage.ts       the local working copy (localStorage)
    remote.ts        publishing: catalogue + per-document version history
  game/
    Scene.ts         the playing surface
    game.ts          createGame(host) — a pixi app sized to any element
    mount.ts          route `/`: full-screen, with the tap gate
  creator/           Preact authoring UI
  viewer/            route `/view`
  ui/                hand-written pixi widgets (see below)
  persistence/       generic versioned snapshot storage
```

**`src/config.ts`** — any leaf is overridable from the URL by dotted path, so
you can tune a build you already deployed:

```
/?game.itemSize=0.25&game.bob=0&game.debugHitArea
```

Unknown keys warn and fall back to the default. `h` toggles hit areas at
runtime.

**`src/ui/`** — `Overlay` (the tap gate, used by `/`) plus `IconButton`,
`Toggle`, `Stepper`, `Selector` and `ScrollView`, which nothing uses yet.
Hand-rolling pixi widgets is tedious enough that they are worth keeping
around; delete the ones you don't reach for.

**`src/persistence/`** — content-addressed snapshots with a version index,
behind a `StorageAdapter`. Ships with `LocalStorageAdapter`, `S3Adapter`
(presigned URLs) and `CompositeAdapter` (local cache + authoritative remote).
Documents are immutable and named by hash, so a `?v=<hash>` link keeps
resolving forever.

## Storage and publishing

Saving is local and automatic. Publishing writes an immutable version to a
bucket and moves a catalogue pointer — the only thing anyone else can see.

Publishing needs a presign endpoint: a small server that answers
`GET <endpoint>?op=get|put|delete&key=…` with `{ "url": "<presigned-url>" }`,
authorises the caller itself, and rejects keys outside your prefix. Nothing
secret reaches the client. Set `VITE_PRESIGN_ENDPOINT` (see `.env.example`),
or leave it unset and publishing stays in localStorage — every screen still
works, it just tells you nothing is shared.

Two things that will bite you:

- **CORS.** Presigned URLs work from `curl` and fail in the browser unless the
  bucket returns `Access-Control-Allow-Origin`. `src/doc/remote.ts` names this
  in the error message, because the symptom is a bare "Failed to fetch".
- **Secure contexts.** Hashing uses `crypto.subtle`, which does not exist on a
  plain-HTTP LAN address. Use `localhost` or https.

## Deploying

Push to `main`. `.github/workflows/deploy.yml` runs `npm run build` (lint and
tsc included, so a broken commit fails there) and publishes `dist/` to Pages.

Two bits of setup: enable Pages with **GitHub Actions** as the source in
Settings → Pages, and — only if you are publishing to a bucket — add
`VITE_PRESIGN_ENDPOINT` as an Actions repository *variable*. It is a variable
and not a secret on purpose: Vite inlines it into the bundle, so calling it a
secret would only hide it from the build log.

Pages serves no history fallback, so `vite.config.ts` copies `index.html` to
`404.html` and lets the router resolve the path.
