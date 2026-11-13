# Recognizer fixtures

Real strokes recorded from the app for deterministic tests of the $P recognizer.

## Format

Each JSON file has the following structure:

```json
{
  "name": "<expected label, or 'garabato'>",
  "knownFailure": true,
  "strokes": [
    { "id": "ink_1", "points": [x0, y0, x1, y1, ...] },
    { "id": "ink_2", "points": [x0, y0, ...] }
  ]
}
```

- `name`: name of the object expected as the recognizer's top-1, or `"garabato"` (scribble)
  if the gesture must not be recognized (score < DEFAULT_THRESHOLD with every template).
  The field is normalized to lowercase on load (`trim().toLowerCase()`) and must match
  the object name in the library (always lowercase, e.g. `"sol"`, `"nube"`).
- `knownFailure` (known failure) _(optional)_: if `true`, the top-1 test is marked `it.fails`.
  It documents known limitations of the recognizer without turning the suite red.
  Example: the sun fixture was recorded with the 10 rays in a single continuous stroke
  without lifting the pen; the connecting segments between rays create a dense ring of points
  and the recognizer confuses the figure with `circulo` (score ~0.33) instead of `sol` (~0.10).
  If the recognizer improves in the future and this case starts to pass, vitest will fail,
  signaling that the flag should be removed.
- `strokes`: strokes in the `InkStroke` format (`src/ink/model.ts`), with flattened x,y pairs.

## How to record

> **Retired workflow.** The **"Export ink"** button that generated these fixtures was
> removed from the UI when the toolbar moved to icons (it was fixture tooling). There is no
> longer a way in the app to record new fixtures. If more are needed, reintroduce the
> utility as a hidden dev tool or serialize `activeInk(state.document).strokes` by hand.
> The format and the already recorded fixtures remain valid; only the button was lost.

Original procedure (when the button existed), kept as a reference for the format:

1. Open the app in dev mode.
2. Draw the figure with the pencil tool (it may be multistroke).
3. Press the **"Export ink"** button (controls panel, next to the ink tools).
4. The button asks for the name of the expected object (e.g. `circulo`) or `garabato` if the
   gesture must not be recognized; type it and confirm. The downloaded file already includes that
   name both in the `name` field of the JSON and in the file name (`fixture-<name>-<ts>.json`).
5. Copy the downloaded file into this folder.

## Status

The fixture infrastructure is ready; the real files are recorded by hand.
The tests skip automatically if this folder is empty (`describe.skipIf`).
