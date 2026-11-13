# Architecture

Gis has three parts connected by one thing: a small JSON contract.

```
Voice ──► Laya ──► gis-texto ──► Validator ──► Layout ──► Animation
(Web      decides   writes the    drops bad     places      draws it
 Speech)  structure  strings      operations    everything  stroke by stroke
          └──────── sidecar ──────┘             └──────── browser app ─────┘
```

1. **Speech.** The browser's Web Speech API turns the teacher's voice into text. Each phrase becomes a *turn*; turns are queued and processed one at a time (`src/speech/`).
2. **Sidecar** (`sidecar/server.py`, Python). For each turn the app posts the phrase plus a summary of the current board. **Laya**, a non-autoregressive encoder fine-tuned for this task, decides the *structure* of the answer (add a section, a concept, an arrow, highlight a word, or nothing). **gis-texto**, a Qwen3-0.6B fine-tune served by ollama, writes only the text strings. The sidecar assembles the result into an envelope.
3. **Validator** (`src/validator/`). Checks the envelope against the Zod schema, operation by operation. A malformed operation is discarded with a log line and the rest continue; there is a cap of 20 operations per turn in live mode.
4. **App** (`src/`). Applies the operations to the scene, lays out the board and animates it.

The JSON contract is the *only* coupling between these parts. The board works the
same if the JSON comes from the models, from a file (that is how the demo works) or
from someone typing it.

## The contract

An envelope looks like this:

```json
{
  "schema_version": "1.0",
  "operations": [
    { "op": "add", "id": "titulo_1", "object": "texto", "text": "The food chain", "role": "titulo" },
    { "op": "add", "id": "sol_1", "object": "concepto", "label": "the **Sun**", "group": "g1" }
  ]
}
```

`operations` is an ordered list, and the order is the script of the animation. An
empty list is valid and common (the teacher said something that does not belong on
the board). Operations are defined in `src/contract/operations.ts`:

| `op` | Meaning |
|---|---|
| `add` | Put something on the board: `object: "texto"` (with `text` and an optional `role`: `titulo`, `subtitulo`, `cuerpo`, `lista`, `enumeracion`) or `object: "concepto"` (a circle with a free-text `label`). Optional `group` adds it to a section; the first `add` with a new group id creates it. Keywords go in `**bold**`. |
| `connect` | Draw an arrow or line between two objects (`style`: `arrow`, `line`, `double_arrow`), with an optional label. |
| `label` | Set the label text of an existing object. |
| `highlight` | Emphasize objects, or a single word inside one (`{ ref, word }`), in sequence. |
| `group` / `ungroup` | Gather objects under a heading, or dissolve a group. |
| `update` | Change the `text` or `label` of an object. |
| `delete` | Remove an object. |
| `clear` | Wipe the board. |

IDs are suggestions: the app renames them if they collide. Models cannot say
colors, sizes, or coordinates; the contract has no such fields on purpose.

## Why the model never decides positions

Small models are bad at geometry and good at deciding *what is worth writing*.
Splitting the work that way keeps the contract tiny (easy to learn, easy to
validate) and makes boards predictable. The layout is deterministic code: given the
same operations in the same order, you get the same board. Things already drawn are
never moved, because the teacher may be pointing at them.

## Layout and animation

The layout (`src/layout/`) treats the board like a page: a title strip on top,
then sections packed into columns of areas. A new section goes where there is room;
text paragraphs grow to the right before growing downward; sections that do not fit
split across columns; concepts flow in rows; numbered lists are numbered by the app.
Colors are assigned per section.

The animation (`src/animation/`, `src/canvas/`) turns the ordered operations into a
timeline: text appears letter by letter, shapes and arrows are drawn as strokes at
pen speed, with small pauses, and a rough.js wobble makes them look hand-drawn.
Everything stays a live object on a Konva scene graph, so the teacher can select,
move, erase or draw on top of it.

## Sidecar API

The app reaches the sidecar through the Vite dev proxy at `/api/sidecar`; the
sidecar itself listens on `127.0.0.1:8731`.

- `GET /health` returns `{ ok, checkpoint, device, textReady }`, plus `textError` if the text model failed to load and `vramMiB` when on CUDA.
- `POST /turn` takes `{ "state": <board summary>, "utterance": "<phrase>" }` and returns `{ "envelope": { "schema_version": "1.0", "operations": [...] }, "metrics": { "deciderMs", "textMs", ... } }`. If a request waits too long behind a slow turn it is answered with an empty envelope and `"dropped": "stale"` in the metrics. Errors return `{ "error": "..." }`.

Everything works with no configuration. These environment variables override the
defaults:

| Variable | Default | What |
|---|---|---|
| `GIS_SIDECAR_PORT` | `8731` | Port the sidecar listens on |
| `GIS_SIDECAR_CHECKPOINT` | `models/laya-v1` | Folder with the Laya checkpoint |
| `GIS_SIDECAR_DEVICE` | auto | `cuda` or `cpu` |
| `GIS_OLLAMA_URL` | `http://127.0.0.1:11434` | Where ollama is listening |
| `GIS_TEXT_MODEL` | `gis-texto-v1` | Name of the text model in ollama |

`python3 sidecar/server.py --fake` starts a sidecar with no models that answers
every turn with "nothing to add"; it needs neither PyTorch nor ollama.

## Where things live

| Path | What |
|---|---|
| `src/contract/` | Zod schemas for the envelope and operations |
| `src/validator/` | Operation-by-operation validation |
| `src/document/` | Document model, applying operations, promoting hand-drawn ink |
| `src/scene/` | Scene graph, text runs, concept measuring, list numbering |
| `src/layout/` | Board layout: areas, columns, geometry |
| `src/canvas/` | Konva rendering, fonts, rough.js, connection geometry |
| `src/animation/` | Timeline and stroke path lengths |
| `src/speech/` | Web Speech provider, turn queue, gate |
| `src/sidecar/` | Browser client for the sidecar |
| `src/ink/` | Freehand strokes drawn by the teacher |
| `src/recognizer/` | Recognizes hand-drawn figures against the templates |
| `src/library/` | Loads the figure templates from `objects/` |
| `src/demo/` | Demo mode, lesson player, and the 40 recorded lessons (`lessons/`) |
| `src/hooks/`, `src/ui/` | App state hooks; menus, toolbar, dialogs, mic button |
| `sidecar/` | `server.py` and `gis_sidecar/` (board summary, protocol, decider, text writer, filters), tests |
| `objects/` | Figure templates (SVG + metadata) |

The static demo (`npm run build:demo`) sets `VITE_GIS_DEMO=1`: the microphone and
sidecar calls are disabled and the recorded lessons are the only input.

## Recorded lessons and the demo

A recorded lesson is a JSON file in `src/demo/lessons/`: a title plus a list of turns,
each with the phrase a teacher might say and the envelope the models produced for
it. The lesson player feeds those envelopes through the same validator and the same
animation path as live turns, so a replay looks exactly like a live session. The
lessons are also the easiest way to test layout changes: replay all 40 and look.

## Failure behavior

Gis is meant to be used in front of a class, so failures are quiet:

- A bad operation is dropped; the rest of the turn still applies.
- If the text model fails or runs out of memory, the turn is reported as a failure, not as "nothing to add", and the board stays as it was.
- If the sidecar is slow, stale requests are discarded instead of piling up.
- Hand-drawn ink is invisible to the models unless it is recognized as a known figure.
