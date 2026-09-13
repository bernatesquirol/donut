# donut

The alphabet game, with a console for whoever is running it.

Two contestants, one clock each, and a ring of the whole alphabet apiece — the
donut. The host reads a clue, the contestant answers, and the host rules on it
with one key. Right keeps the clock running; a wrong answer or a pass stops it
and hands over. Whoever has the most letters when both clocks are spent takes
the round.

The clue is only on screen while the clock is running, so a pause is never
free thinking time: the host starts the clock and reads in one move.

There is a creator for writing the clues and a published view for sharing a
round, both around the same PixiJS scene the game runs.

```
npm install
npm run dev      # http://localhost:8080
npm run build    # lint + tsc + vite build, exactly what CI runs
npm run preview  # serve the built site exactly as it will be deployed
```

## The four surfaces

| URL        | What it is                                  | Built with      |
| ---------- | ------------------------------------------- | --------------- |
| `/`        | the host's console, full-screen              | PixiJS          |
| `/play`    | one contestant's screen, live                | PixiJS          |
| `/creator` | authoring: a clue per letter, save, publish  | Preact          |
| `/view`    | one published round, from a link             | Preact + PixiJS |

Each is a dynamic import, so opening the game never downloads the creator.

`/` resolves its round in that order of preference:

| URL              | Plays                                                  |
| ---------------- | ------------------------------------------------------ |
| `/`              | the last document saved in this browser, else the demo |
| `/?id=<docId>`   | this browser's copy if it has one, else the published one |
| `/?id=…&v=<hash>`| that exact published version, ignoring any local copy  |

So a published round is playable from a link on a machine that has never
opened the creator — the console, keyboard and all, not just the board. The
creator prints all three links once you publish.

If an `?id=` cannot be resolved either locally or from the store, `/` says so
and stops. It deliberately does not fall back to the local working copy:
quietly playing a different round looks exactly like the link working.

`/view?id=…` is the read-only board for the same published document, for
anyone who should see a round without being able to rule on it.

## The keys

Everything the host does mid-round is a key, because the clock is running
while they do it. Press `H` in the game for this list on screen.

| Key         | What it does                                       |
| ----------- | -------------------------------------------------- |
| `SPACE`     | start or pause the clock                           |
| `ENTER`     | right — scores, and the clock keeps running        |
| `BACKSPACE` | wrong — scores, stops the clock, hands over        |
| `P`         | pass — hands over, and the letter comes back later |
| `TAB`       | change contestant, pausing the clock               |
| `←` `→`     | move to another letter without ruling this one     |
| `Z`         | undo — including a hand-over or a clock that ran out |
| `O`         | reopen this letter, as if it had never been asked  |
| `A`         | show or hide the answer                            |
| `M`         | mute or unmute the cues                            |
| `R`         | restart the round                                  |

`Z` covers everything, so a mis-key under time pressure is always
recoverable — including the clock hitting zero, which is snapshotted like any
other action.

One mistake costs the turn — `game.strikes`, which defaults to 1. Raise it for
a gentler round: `?game.strikes=2` gives each contestant two mistakes before
the table passes, the status line turns red and reads `STRIKE 1 OF 2` while one
is outstanding, and the key card rewords itself to match. Strikes are counted
per turn rather than per round, so they clear whenever a contestant loses the
table — which means a pass wipes one.

Both questions are on the console at once: one panel per contestant, the one
being read out ringed in accent and the waiting one dimmed beside it. The
table moves between the two donuts on a single clock, so a host who can only
see the letter in play has to go looking for the next one in a document while
that clock runs. Below about 620px of stage there is only room for one panel,
and the question in play wins. Contestants' screens are unaffected — the wire
carries the letter on the table and nothing else, so no screen but the host's
can show the other seat's next clue.

Stopping the clock hides the clue — `game.hideCluePaused`, on by default.
The letter stays on show, because the donut is already pointing at it; it is
the clue and the answer that go. `?game.hideCluePaused=off` keeps them up if
you would rather adjudicate a disputed answer with the clue still readable.

The cues (right, wrong, pass, hand-over, the last few seconds ticking down,
time up, round over) are synthesised with an oscillator in
[`src/game/audio.ts`](src/game/audio.ts) rather than loaded, so there are no
audio files to lose and nothing to wait for. Browsers will not start an
`AudioContext` without a gesture, which is what the card on the way in is for.

## Live screens

The host console publishes the state of a round in progress to Firebase
Realtime Database, and each contestant opens their own screen:

```
/play?id=<docId>&k=<liveKey>&seat=<name>
```

Their donut large, the opponent's small beside it, both clocks, and the clue
while the clock runs. The creator prints the link for each contestant — the
seat is their *name*, so the link is readable, which also means renaming a
contestant breaks the link you already sent them.

Three things about the design are worth knowing before changing any of it.

**No answer ever reaches the wire.** `MatchState` holds every clue and every
answer, so publishing it would put the whole round in a database the
contestants' own screens read. What goes out is a `LiveMatch`
([`src/live/types.ts`](src/live/types.ts)): letters, rulings, scores, and the
current clue. There is no field for an answer, so no later change can start
sending one by accident. The scene renders a `MatchView`
([`src/game/view.ts`](src/game/view.ts)) rather than the state, which is what
makes that boundary structural instead of a rule someone has to remember.

**The clock is an anchor, not a reading.** A reading is stale the moment it is
sent, and a screen given one would show a frozen clock between rulings — the
host only writes when something happens. So the payload carries *when the run
started*, in server time via `/.info/serverTimeOffset`, and every screen runs
the same countdown off its own frame loop. A contestant's laptop being two
minutes out does not make their clock two minutes wrong.

**The room name needs the document's `liveKey`.** The document id is not a
secret — it is in every published share link and in the S3 catalogue — so with
open rules it alone would let anyone who had seen a link write into a live
round. The key is the unguessable half; regenerate it in the creator to shut
out links you have handed out.

### Setting it up

Locally: copy the web config from Firebase console → Project settings → Your
apps into `.env.local` (see [`.env.example`](.env.example)). That file is
gitignored.

In production the same five names are **Actions repository variables** —
Settings → Secrets and variables → Actions → Variables:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_DATABASE_URL
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_APP_ID
```

Variables and not secrets, for the same reason as `VITE_PRESIGN_ENDPOINT`:
Vite inlines them into the bundle, so they are public the moment the site is
deployed. Calling them secrets would hide them from the build log and nowhere
else. A web config identifies a project; it authorises nothing.

Then deploy the rules, which is the part that actually protects anything:

```
npx firebase deploy --only database --project <projectId>
```

[`database.rules.json`](database.rules.json) is what this expects — the rooms
subtree is world-readable and world-writable, everything else is closed. That
is the deliberate trade the `liveKey` pays for: no auth step, nothing to sign
in to, and a round is only reachable by someone holding a link.

Be clear-eyed about what that leaves open. The config is in the public bundle,
so anyone can write to `donut-rooms/<anything>` — they cannot find or corrupt
a *specific* round without its `liveKey`, but they can fill the database with
junk. For a scheduled recording that is fine. If the site is public and busy,
the fix is anonymous auth plus a rule that only a room's creator may write to
it, and App Check to keep other people's builds out.

**Leave the config unset and the live screens still work** — over a
same-browser transport that uses `storage` events, so both screens work on one
machine. Which is also how the whole flow is tested: two tabs, no project.
The host's status bar says `LIVE` or `LIVE · LOCAL` so it is never a mystery
which one you have.

## The one idea

A **document** describes the round; the **scene** renders it; a **match**
decides what any of it means.

```
src/doc/types.ts     GameDoc — two boards, a clue and an answer per letter
src/game/match.ts    the rules and the clocks, with no pixi in the file
src/game/Scene.ts    draws a GameDoc plus a MatchState, one frame at a time
src/game/controls.ts the key table, which is also the on-screen guide
```

The scene is a renderer and nothing else:

```ts
scene.setDoc(doc); // content in
scene.setState(state); // the live match, on every change
scene.resize(w, h); // the host owns the size; the scene never reads the window
scene.update(deltaMS); // one tick
scene.onTap = (hit) => {}; // a letter was clicked, in document terms
```

`createGame()` builds the match as well as the scene, so every surface obeys
the rules — the creator's preview really does put the first playable letter on
the table and read the authored time limit. Only `/` binds a keyboard to it,
which is why the preview is live but silent and still.

Two consequences worth knowing:

- **The clock is read, not accumulated.** Pixi's ticker clamps `deltaMS` to
  100ms, so integrating per-frame deltas makes the clock run slow on a machine
  dropping frames or in a throttled tab. `Match` anchors to `performance.now()`
  instead; 150 seconds is 150 seconds. The clock is injectable
  (`MatchOptions.now`) so the rules can be tested without waiting.
- **A letter with no clue is not in play.** The game steps over it and the
  donut draws it faintly, so a half-authored board is playable rather than
  broken. That is also what makes the creator's preview useful from the first
  clue you type.
- **The preview overrides `hideCluePaused`.** Its clock never starts, so the
  game's rule would blank the one thing being authored. It is the only place
  that overrides the config, and [`Preview.tsx`](src/creator/Preview.tsx) says
  so at the point it does it.

## Authoring

`/creator` is the real game on top and a clue per letter underneath. Clicking a
letter on the donut selects its row; typing a clue puts that letter into play
in the preview immediately.

A round is 26 clues and 26 answers, twice, and nobody types that into a form.
So **Paste a list** takes whatever shape the round was written in and reads it
into the board — a document, a chat message, a column out of a spreadsheet:

```
A - terme que els xavals fan servir per dir el cool que és algú (aura)
B. el millor i el pitjor servei de Barcelona alhora (bicing)

A<TAB>clue<TAB>answer          straight out of Excel
clue<TAB>answer                letters taken from the order instead
```

A letter in front is used when there is one, an answer in brackets or in a
column of its own is picked up, and a line that neither announces a letter nor
carries an answer is read as the line above wrapping. `Contains` is inferred
when the answer holds the letter somewhere other than the front. The card
shows what it understood before anything is written, and you can also paste
straight into the table — a list dropped on a row fills downwards from it.
[`src/doc/paste.ts`](src/doc/paste.ts) has the rules and nothing else; the
card is [`PasteList.tsx`](src/creator/PasteList.tsx).

Each contestant gets their own board. They are separate on purpose: the two
take turns on the same clock, so sharing clues would mean the second one had
already heard the answers. `Contains` is for letters no useful word begins
with — the host reads "contains X" instead of "starts with X".

Saving is local and automatic. Publishing writes an immutable version to a
bucket and moves a catalogue pointer — the only thing anyone else can see —
and then shows the three links above. Editing afterwards does not change what
those links serve until you publish again, which is what makes the pinned
`&v=` one safe to send ahead of a recording.

## What's in the box

```
src/
  main.ts            route table
  router.ts          path router, root-relative or under a subpath
  config.ts          every tunable, overridable from the query string
  theme.ts           palette + metrics for the pixi side
  screens.css        the same palette for the DOM screens
  doc/
    types.ts         GameDoc, parseDoc, newDoc, starterDoc
    paste.ts         a pasted list -> rows -> a board
    storage.ts       the local working copy (localStorage)
    remote.ts        publishing: catalogue + per-document version history
  game/
    match.ts         the rules and the clocks
    view.ts          MatchView — what a screen draws, and may know
    controls.ts      the key table
    audio.ts         the cues, synthesised
    Rosco.ts         one contestant's donut
    QuestionPanel.ts one question on the table, active or waiting
    Scene.ts         the playing surface
    game.ts          createGame(host) — pixi + a match, sized to any element
    board.ts         createBoard(host) — the same scene with no rules behind it
    mount.ts         route `/`: full-screen, keyboard, sound
  live/
    types.ts         LiveMatch (the wire format) + LiveTransport
    project.ts       MatchView <-> LiveMatch
    session.ts       HostSession (publishes) + ClientSession (follows)
    localTransport.ts  a same-browser stand-in, for one-machine rehearsal
  player/            route `/play`
  creator/           Preact authoring UI
  viewer/            route `/view`
  ui/                hand-written pixi widgets
  persistence/       generic versioned snapshot storage
    firebase/        Realtime Database, as a LiveTransport
```

**`src/config.ts`** — any leaf is overridable from the URL by dotted path, so
you can tune a build you already deployed:

```
/?game.timeLimit=30&game.strikes=2&game.showAnswer=off&game.volume=0
```

`game.timeLimit` overrides the document, which is how you run a short round
without re-authoring one. Unknown keys warn and fall back to the default.

**`src/ui/`** — `KeyGuide` (the card on the way in, and the `H` overlay) plus
`IconButton`, `Toggle`, `Stepper`, `Selector` and `ScrollView`, which nothing
uses yet. Hand-rolling pixi widgets is tedious enough that they are worth
keeping around; delete the ones you don't reach for.

**`src/persistence/`** — content-addressed snapshots with a version index,
behind a `StorageAdapter`. Ships with `LocalStorageAdapter`, `S3Adapter`
(presigned URLs) and `CompositeAdapter` (local cache + authoritative remote).
Documents are immutable and named by hash, so a `?v=<hash>` link keeps
resolving forever.

## Storage and publishing

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

The site is built for the **root**, so the links you hand out are the short
ones: `example.com/creator`, `example.com/play?seat=Ana`. That is what a
custom domain, a `<user>.github.io` repo and any ordinary static host serve.
A GitHub Pages *project* page is the exception — it is served from
`<user>.github.io/<repo>/` whether you like it or not, and assets that do not
know that prefix all 404. For that one case set a `BASE_PATH` repository
variable to `/<repo>/`; the workflow passes it to the build and
[`src/router.ts`](src/router.ts) prefixes and strips it. Leave it unset
otherwise.
