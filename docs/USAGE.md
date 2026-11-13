# Using Gis

## Teaching with it

- Speak in short phrases and pause between ideas. The board follows what you say, one sentence at a time.
- Say a topic and what belongs to it; the board opens a section per idea and puts a circle around each concept.
- Repeating yourself is fine: Gis does not redraw what is already on the board, it can highlight a word instead.
- The board is yours too: draw with the pen and erase with the eraser. What you draw by hand is invisible to the models.

## Menus and shortcuts

- **File → Play a lesson** replays one of the 40 recorded lessons, with no models.
- Tools: move (`V`), pen (`P`), eraser (`E`); undo with `Ctrl+Z`.
- **View → Developer mode** shows the turn queue and the raw JSON the model produced for each phrase.

## Static demo

`npm run build:demo` builds the replay as a static site in `dist/`, with no server-side code. Host it anywhere
(GitHub Pages, Netlify, a Raspberry Pi behind nginx). The microphone and the models are disabled in that build.

## Limitations

- English only, and aimed at primary-school science lessons.
- Voice input needs Chrome or Edge and an internet connection (Web Speech). Web Speech sends your audio to the browser vendor's speech service (Google, in Chrome); the Gis models themselves run entirely on your machine.
- A GPU gives comfortable speed; on CPU each turn is noticeably slower.
- The models are small: they sometimes miss an idea, add an odd one, or file an idea under the wrong section.
