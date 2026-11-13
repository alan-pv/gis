# Gis

**A smart blackboard that writes and draws while the teacher talks.**

[![CI](https://github.com/alan-pv/gis/actions/workflows/ci.yml/badge.svg)](https://github.com/alan-pv/gis/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Watch the demo](https://img.shields.io/badge/%E2%96%B6_Watch_the_demo-YouTube-red?logo=youtube&logoColor=white)](https://www.youtube.com/watch?v=CtOVB2-lHuE)

![Gis writing a lesson on the food chain while a teacher speaks](docs/images/demo.gif)

## What is it?

Gis listens to a teacher explaining a topic and builds the board for them, live:
a title, sections, concepts in circles, arrows between ideas and bold keywords,
written progressively as if a hand were holding the chalk. It is made for
primary-school science, in English.

- **Talk, and the board writes itself.** No typing, no slides to prepare.
- **Structured like a real teacher's board.** The layout is inspired by *bansho*, the Japanese practice of planning the blackboard as the story of the lesson ([details](docs/BANSHO.md)).
- **The models run on your computer.** No cloud AI model, no account, no subscription.
- **Free and open source** (MIT). No ads, ever.

## How it works

The browser turns speech into text. **Laya**, a small fine-tuned model, decides what
the board needs for each sentence (a section, a concept, an arrow, a keyword to
highlight, or nothing) and **gis-texto**, a 0.6B language model, writes only the
words. The model never decides positions: the app owns all the geometry. Details in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Try it

### Run it locally

Requirements:

- Linux (macOS works on a best-effort basis; on Windows use WSL2)
- Node.js 22 or newer
- Python 3.10 to 3.13
- [ollama](https://ollama.com/download)
- Chrome or Edge, for the microphone (Web Speech API)
- Disk space: the models are about 1.3 GB, and the Python dependencies add several GB (PyTorch with CUDA is about 5 GB; the CPU build is much smaller)
- An NVIDIA GPU with at least 4 GB of VRAM is recommended. It also runs on CPU, only slower.

```bash
git clone https://github.com/alan-pv/gis.git
cd gis
npm run setup   # installs dependencies, downloads and verifies the models, registers them in ollama
npm start       # starts ollama, the model sidecar and the app
```

Open <http://localhost:5173>, click the microphone and start teaching.

Web Speech sends your audio to the browser vendor's speech service to transcribe it
(see [limitations](docs/USAGE.md#limitations)).

### Just watch it (no models, no GPU)

The app ships with 40 recorded lessons that replay without any model. After
`npm ci`, run `npm run dev`, open the app and choose **File → Play a lesson**. You can also build it as a static site
([how](docs/USAGE.md#static-demo)).

## Documentation

- [Using Gis](docs/USAGE.md): tips, shortcuts, static demo and limitations
- [Architecture](docs/ARCHITECTURE.md): how it works and where things live
- [Bansho](docs/BANSHO.md): the teaching practice behind the layout
- [Contributing](docs/CONTRIBUTING.md): development setup and checks

This is an early project; expect rough edges.

## License

[MIT](LICENSE). Credits:

- [Laya](https://huggingface.co/convaiinnovations/laya) by ConvAI Innovations (Apache-2.0)
- [Qwen3](https://github.com/QwenLM/Qwen3) by the Qwen team (Apache-2.0)
- [Kalam](https://fonts.google.com/specimen/Kalam) font (SIL OFL)
- [rough.js](https://roughjs.com) and [Konva](https://konvajs.org)

Model weights are distributed as GitHub Release assets under their respective licenses.
