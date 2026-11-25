# Phone and chat

`s.phone` draws a smartphone and `s.chat` a messenger chat, inside the phone
or on their own. Both follow the look: its colors, fonts and hand-drawn lines
in `paper`, `chalk` and `blueprint`. They enter on `at`, leave on `out`, make
no sound unless you give them `sfx`, and `check` sees them like other shapes
and text. `explainroo docs scene-api` has the options most elements take.

```js
s.phone({ app: 'Messages', input: { text: 'see you', at: 'see' }, keyboard: { suggestions: ['later', 'soon'], pick: 1, pickAt: 'soon' } }, (sc) => {
  s.chat([
    { from: 'them', text: 'Dinner at 7?', at: 0.2 },
    { from: 'me', text: 'Yes!', at: 'yes' },
  ], { in: sc, names: { them: 'Mom' }, typing: { at: 0.6 } });
});
```

## Text size

`size` is the size of the phone's own text and of the chat's bubbles, in
pixels. By default it is 40 in a tall or square 1080 pixel wide frame, which
is what `check` asks of labels there, and 32 in a 1920 x 1080 frame, scaled
with the frame. A chat inside a phone takes the phone's size. The screen holds
about nine letters of that size in a row, so where the phone has to be
narrower, its default text gets smaller to fit.

## s.phone(options, fn)

A phone with a body, a screen, a status bar with the time and a home bar.

| Option | Meaning |
|---|---|
| `x`, `y` | the center (the center of `s.safe`) |
| `h` | the height: 0.7 of `s.safe.h` in a tall frame and 0.84 in others, so a punch-in keeps it out of the caption band. Where the content area is short, as on Shorts and TikTok, the phone gets a little wider and up to 0.9 of `s.safe.h` tall before its text gets smaller |
| `w` | the width, by default `h` times 0.49; with only `w`, the height follows |
| `size` | the text size, see above |
| `dark` | `true` for a dark screen, `false` for a light one (the look's: dark looks get a dark screen) |
| `color` | the color of the caret and of the ring on a picked suggestion (`accent`) |
| `time` | the time in the status bar (`'9:41'`) |
| `app` | a title in a bar at the top of the screen, like `'Messages'` |
| `input` | a text field above the keyboard, see below; a string is its text |
| `keyboard` | `true` or `{ at, suggestions, suggestAt, pick, pickAt }`, see below |
| `enter` | how the phone comes in (the look's entrance for images, or `fade`) |
| `exit`, `outDur` | how it leaves at `out`, with all it holds |
| `id` | a name for arrows, `s.annotate` and `s.get` |
| `scale`, `rotate`, `opacity` | extra changes to the whole phone |
| `camera` | `false` keeps the automatic camera from moving to it |

`input` takes `text`, `at` (when the text starts, by default the keyboard's
`at`), `boxAt` (when the field shows, by default the phone's `at`), `enter`
(`type`, the default, types the text at `cps` letters a second, 16; `fade`
or another entrance shows it at once), `cps` and `caret: false`. A blinking
caret in the `color` waits in the field. A text longer than the field scrolls
to its end, as in a real field.

`keyboard` slides up from the bottom of the screen at its `at`. Its
`suggestions` (a list of words) show in a bar at `suggestAt`, and `pick`, the
number of one of them from 0, gets a ring at `pickAt`. A wrong `pick` stops
the scene with an error. `check` warns about a suggestion that does not fit
its place in the bar.

`fn(screen)` draws on the screen, in frame pixels. `screen` is the area above
the field and the keyboard, below the status bar and the title:
`{ x, y, w, h, left, top, right, bottom, unit, size, fill, ink, muted, dark,
at, out }`. `x` and `y` are its center, `unit` is a twentieth of its width,
`size` the phone's text size, `fill` its color and `ink` and `muted` the text
colors that read on it. `check` measures text drawn in `fn` against the
screen, so give it `color: sc.ink`. What `fn` draws comes and goes with the
phone, and moves with it. `check` warns when the screen has less room than
two lines of text.

It returns the phone's box `{ x, y, w, h, left, right, top, bottom }` with
`.screen`.

## s.chat(messages, options)

`messages` is a list of `{ from: 'me' | 'them', text, at }`. The bubbles go
from the top of the area down, mine on the right in the accent color and
theirs on the left, each popping in on its `at`. The text in a bubble starts
at its left and wraps at 80% of the chat's width. Words in `*stars*` show in
the accent in their bubbles and in the text color in mine. A message also takes `out`, `id`, `enter`,
`exit` and `sfx`.

| Option | Meaning |
|---|---|
| `in` | an area to draw in, like the `screen` of `s.phone`; a box with `left`, `top`, `w` and `h`, or with `x`, `y` as its center, works too |
| `x`, `y`, `w`, `h` | without `in`: the center and the size of the area (the center of `s.safe`, 0.9 of its width but at most 20 times `size`, and 0.9 of its height) |
| `size` | the text size, see above |
| `names` | `{ them: 'Mom', me: 'Me' }`: a name above the first bubble of that side |
| `typing` | `{ at, out }`: three dots in their bubble, in the place of the next message from them, until it comes (`out`) |
| `color` | the color of my bubbles (`accent`) |
| `them` | the color of their bubbles (a shade between the background and the ink) |
| `at`, `out` | for messages without their own |
| `enter`, `exit`, `outDur` | how the bubbles come and go (`pop`, `fade`) |
| `scroll` | `false` keeps it from scrolling, see below |
| `overlap` | `true` when the bubbles may overlap other shapes |
| `id` | a name for `s.get` and arrows, for the box around the bubbles |
| `camera` | `false` keeps the automatic camera from moving to it |

My bubbles show their text in white or in near black, whichever reads better
on the accent color, so a light accent like the yellow of `blueprint` gets
dark text. Their bubbles use the ink of the screen or the look.

When the messages don't fit, the chat scrolls up as each new one comes in,
as a messenger does. What leaves the top is cut off there, under the title
bar inside a phone, and `check` leaves it alone. With `scroll: false` it
doesn't scroll, and `check` warns that it runs below its area. A bubble taller
or wider than the chat gets a warning too.

It returns `{ bubbles, bottom, top, left, right, x, y, w, h }`: each bubble's
box with its `from` and `at`, where it is at this moment, the bottom of the
last one, and the area.
