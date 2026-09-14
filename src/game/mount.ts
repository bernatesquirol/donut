import { loadConfig, type AppConfig } from "../config";
import { RemoteStore } from "../doc/remote";
import * as storage from "../doc/storage";
import { starterDoc, type GameDoc } from "../doc/types";
import { HostSession } from "../live/session";
import { createTransport } from "../live/transport";
import { roomPath } from "../live/types";
import { readVersionFromUrl } from "../persistence";
import { Confirm } from "../ui/Confirm";
import { KeyGuide } from "../ui/KeyGuide";
import { addNotice, failNotice } from "../ui/notice";
import { Sfx } from "./audio";
import { bindKeyboard, guideRows } from "./controls";
import { createGame } from "./game";
import { redactionForAudience, viewOf } from "./view";

/**
 * Route `/`: the host's console, full-screen.
 *
 * This file is the only place the three halves meet: `match.ts` has the
 * rules, `Scene.ts` draws them, `controls.ts` names the keys, and the wiring
 * between them is short enough to read in one go.
 */
export async function mount(root: HTMLElement): Promise<void> {
  root.classList.add("fullscreen");

  const config = loadConfig();

  // Resolving may go to the network, so say so, and stay on this notice if it
  // comes back empty-handed.
  const notice = addNotice(root, "Loading…");
  let doc: GameDoc;
  try {
    doc = await resolveDoc(config);
  } catch (err) {
    failNotice(
      notice,
      "Could not load that round",
      err instanceof Error ? err.message : String(err),
    );
    return;
  }
  notice.remove();

  const host = document.createElement("div");
  host.className = "stage-host";
  root.appendChild(host);

  // The live room, so the contestants' screens can follow along. Built before
  // the game so the very first state is published too.
  const transport = createTransport(config);
  const session = new HostSession(
    transport,
    roomPath(doc.id, doc.liveKey),
    doc.title,
  );
  await session.open();

  /**
   * What the contestants' screens are allowed to see. Deliberately not
   * `redactionFor(config)`: the host's own answer toggle must not be able to
   * push answers onto someone else's screen, and the host reads ahead —
   * a contestant seeing a clue they have not been asked yet would be reading
   * ahead too.
   */
  const forContestants = redactionForAudience(config);

  const game = await createGame(host, {
    config,
    doc,
    onChange: (state) => {
      session.publish(
        viewOf(state, doc, config, forContestants),
        game.match.clock,
      );
    },
  });

  // The opening state: a contestant screen opened first should see the board
  // waiting, not an empty room.
  session.publish(
    viewOf(game.match.snapshot, doc, config, forContestants),
    game.match.clock,
  );
  const sfx = new Sfx(config.game.volume);

  // The rules report; the cues are this file's business, so `/view` and the
  // creator preview can run the same match in silence.
  game.match.onEvent = (event) => sfx.cue(event);

  const guide = new KeyGuide(guideRows(config));
  // Added last, so it is over the key card as well as over the stage.
  const confirm = new Confirm();
  game.app.stage.addChild(guide, confirm);

  function sizeOverlays(): void {
    const { width, height } = game.app.screen;
    guide.resize(width, height);
    confirm.resize(width, height);
  }
  game.app.renderer.on("resize", sizeOverlays);
  sizeOverlays();

  /**
   * `R`, which is the one key that cannot be taken back: `reset` empties the
   * undo history along with the round.
   *
   * The clock stops first. Reading a dialog is not playing, and a contestant
   * whose clock drained while the host decided would have paid for the
   * mis-key either way.
   */
  function askReset(): void {
    game.match.stop();
    confirm.ask(
      {
        title: "Restart the round?",
        detail:
          "Every ruling on both donuts goes and both clocks go back to the " +
          "top. Z cannot take this one back.",
        confirm: "restart",
        cancel: "keep playing",
      },
      (ok) => {
        if (ok) game.match.reset();
      },
    );
  }

  /** Reflect whatever the host has switched off, next to the help key. */
  function writeHint(): void {
    const parts: string[] = [];
    if (!config.game.showAnswer) parts.push("ANSWER HIDDEN");
    if (sfx.muted) parts.push("MUTED");
    if (session.error) parts.push("LIVE FAILING");
    else parts.push(transport.kind === "local" ? "LIVE · LOCAL" : "LIVE");
    parts.push("H  KEYS");
    game.scene.setHint(parts.join("  ·  "));
  }

  function openGuide(): void {
    // Opening the card mid-round would otherwise read as a stealth timeout.
    game.match.stop();
    guide.setHeader("KEYS", "ANY KEY OR A TAP TO CLOSE");
    guide.show();
  }

  function closeGuide(): void {
    // The one gesture the browser gives us to start the audio context with.
    sfx.unlock();
    guide.hide();
  }

  guide.onDismiss = closeGuide;
  guide.setHeader(
    doc.title || "Donut",
    "THE ALPHABET GAME · TAP OR PRESS ANY KEY TO START",
  );
  guide.show();

  // Registered before `bindKeyboard`, and it stops the event dead: while
  // either card is up the keyboard belongs to the card, not to a letter
  // nobody has been asked yet.
  window.addEventListener("keydown", (e) => {
    if (!confirm.open && !guide.open) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // The confirm sits over the guide, so it answers first. Every key is an
    // answer — `Y` is yes and the rest are no — and the guide's rule is the
    // same shape: any key closes it.
    if (confirm.open) confirm.handleKey(e.key);
    else closeGuide();
  });

  bindKeyboard({
    match: game.match,
    config,
    toggleAnswer() {
      config.game.showAnswer = !config.game.showAnswer;
      game.refresh();
      writeHint();
    },
    toggleMute() {
      sfx.toggleMute();
      writeHint();
    },
    showGuide: openGuide,
    confirmReset: askReset,
  });

  writeHint();
}

/**
 * Which round to play.
 *
 *   /                 the most recently saved local document, else the demo
 *   /?id=<docId>      that document — this browser's copy if it has one,
 *                     otherwise the published one from shared storage
 *   /?id=…&v=<hash>   that exact published version, ignoring any local copy
 *
 * The remote leg is what makes a published round playable from a link on a
 * machine that has never opened the creator. It also throws rather than
 * falling back: `?id=` used to quietly play whatever that browser happened to
 * have open, which is indistinguishable from the link working.
 */
async function resolveDoc(config: AppConfig): Promise<GameDoc> {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) return storage.loadLatest() ?? starterDoc();

  const version = readVersionFromUrl();

  // A pinned version always comes from the store: localStorage only ever
  // holds the working copy, which is by definition not a published version.
  if (!version) {
    const local = storage.load(id);
    if (local) return local;
  }

  const remote = new RemoteStore(config);
  const fetched = await remote.fetch(id, version ?? undefined);
  if (fetched) return fetched;

  if (!remote.enabled) {
    throw new Error(
      `Nothing saved on this machine under "${id}", and no shared store is ` +
        `configured to look in.`,
    );
  }
  throw new Error(
    version
      ? `No published version "${version}" of "${id}".`
      : `Nothing published under "${id}".`,
  );
}
