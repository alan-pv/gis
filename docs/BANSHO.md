# The board-writing idea behind Gis

Gis is **inspired by *bansho*** (板書), the Japanese practice of writing on the
blackboard on purpose. In a bansho lesson the board is not scratch paper: the
teacher plans it, and by the end of the class it reads as the story of the lesson,
from the question that opened it to the conclusion. Gis is not an implementation
of bansho; it borrows a few of its habits.

## What the board looks like

- **Title and date.** The top-left corner names the topic, with the date beside it, like a notebook page.
- **Sections with headings.** Each idea gets a short heading, and what the teacher says about it is written below as a short paragraph or list. Each section has its own color, so the eye can tell them apart.
- **Concepts in circles.** A key idea that deserves to stand out becomes a circle with its name inside. Related concepts are placed in a row so they read together.
- **Arrows.** Arrows show how things relate: what causes what, what comes before what.
- **Bold keywords.** The important words inside a sentence are written in bold, as a teacher would underline them.
- **A story, top to bottom.** Things appear in the order the teacher says them, filling the board from the top and growing sideways before going further down. Nothing already written is ever moved around while the teacher may be pointing at it.

## Why this matters for the design

Text is the main actor on a real board, and drawings are selective support. That
is why Gis writes structured text first and keeps its drawing vocabulary small: a
circle with a name is enough for most concepts. A small vocabulary is also what
lets a very small model do the job.

It also explains why the model never chooses where things go. A good board is
mostly good layout, and layout is something code can do reliably. The model's job
is the teacher's job in miniature: decide what is worth writing down.

## What Gis does not do

- It does not teach or plan the lesson. The teacher stays in charge; the board follows.
- It does not claim to match how a bansho expert would lay out a given topic. It is a simple, consistent interpretation that makes a talk easy to follow.
- It does not draw detailed illustrations. A teacher can always draw on top of the board with the pen tool.

If you want to read more about bansho itself, search for "bansho" together with
"Japanese mathematics lesson study"; it is a rich and well-documented tradition.
