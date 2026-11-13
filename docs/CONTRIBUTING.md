# Contributing

Contributions are welcome: bug reports, lessons, fixes.
Open an issue first for anything big so we can agree on the direction.

## Setup

```bash
git clone https://github.com/alan-pv/gis.git
cd gis
npm ci
```

You do not need the models or a GPU to work on the app: `npm run sidecar:fake` starts
a sidecar that always answers "nothing to add", and the recorded lessons (File →
Play a lesson) exercise the board without any model.

## Checks to run before a PR

```bash
npm run lint
npx tsc -b
npm test
npm run build
python3 -m unittest discover -s sidecar/tests -t sidecar   # sidecar tests, no PyTorch needed
```

CI runs the same checks.

## Code style

- TypeScript in strict mode; ESLint must pass with no errors.
- Layout, validator and animation changes come with a test.
- Keep the JSON contract small. Please do not add fields to it without discussing it first (see [ARCHITECTURE.md](ARCHITECTURE.md)): the model must never decide positions or colors.
- Code and comments are in English. A few contract literals are Spanish words (`texto`, `concepto`, `titulo`, ...) because the models were trained on them; they are part of the wire format and must not be renamed.

## Adding lessons

A recorded lesson is one JSON file in `src/demo/lessons/`: a title and a list of
turns, each with a phrase and the operations for it. Copy an existing lesson and
edit it; `npm test` validates every lesson against the contract.

## License

By contributing you agree that your work is released under the MIT license.
