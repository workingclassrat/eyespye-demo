# EyeSpye demo

Hands-free reading that notices what you missed. The page scrolls by following your eyes
(webcam only): down as you read, back up when you look up. It tracks which paragraphs you read,
skimmed, or skipped, and at the end shows an AI "What you missed" summary built only from the parts
you didn't read closely, plus a quiz weighted toward those parts. Reports export as Markdown or PDF.
Works on the built-in sample article, any article URL, or a PDF you drag onto the page.

## Run it

```bash
npm install
cp .env.example .env      # then paste your Claude API key into .env
npm run dev               # opens the app on http://localhost:5173 and the API on :8787
```

Open **http://localhost:5173** in Chrome. Without an API key everything still works; the summary panel
falls back to an offline "key sentences" summary.

## Presented as a browser extension

The demo is framed as the EyeSpye browser extension running inside a (mock) browser window:
a **Welcome to EyeSpye** onboarding tab, a reading tab on a sample site, the EyeSpye icon in the
extensions area (click it for the popup), a status pill on the page, and a side panel for the report.
Press **F** (or your browser's fullscreen shortcut) so the mock browser is the only one on screen.
It's a prototype of the extension experience: the real eye tracking, scrolling, summary, and quiz all run.

## How it works

| Piece | File | What it does |
|---|---|---|
| Gaze input | `src/gaze.ts` | Runs [WebEyeTrack](https://github.com/RedForestAI/WebEyeTrack) (MIT) on the webcam, smooths the gaze point. Mouse mode uses the pointer instead. |
| Calibration | `src/calibration.ts` | 5 dots. Each click while looking at a dot teaches the model your eyes. |
| Gaze scrolling | `src/autoFollow.ts` | Eyes below the dashed line → the page follows your reading down. Eyes in the top band for ~0.6 s → it scrolls back up, faster the higher you look. |
| Coverage | `src/coverage.ts` | Time your eyes spent on each paragraph vs. how long it should take to read → read / skimmed / skipped. |
| Smart summary + quiz | `src/ai.ts`, `server/index.ts` | Sends the paragraphs with their labels to Claude: a summary of only the skipped/skimmed ones, and a 5-question quiz (≥3 from what you missed). Offline fallbacks for both. |
| Report panel | `src/panel.ts` | Summary and Quiz tabs, "jump back to section" links. |
| Export | `src/exporter.ts` | Copy / download Markdown, or Save as PDF through the print dialog. Includes your quiz answers. |
| PDF reader | `src/pdf.ts` | Extracts text with pdf.js, rebuilds headings and paragraphs, strips running headers, page numbers, and the reference list. |

Everything about your camera runs on your laptop. Only article text is sent to the AI.

## Controls

Every control is in three places: the **EyeSpye toolbar** at the bottom of the page, the **extension popup**
(click the eye icon in the browser toolbar), and the keyboard. The toolbar's **Eyes / Mouse** switch changes
input mode at any time; hovering the toolbar never scrolls the page.

| Key | Action |
|---|---|
| Space | Pause / resume auto-follow |
| D | Show tracking (gaze marker, paragraph tints, scroll zones) |
| M | Switch between Eye mode and Mouse mode |
| C | Recalibrate |
| S | Summarize now |
| R | Reset reading (for rehearsing) |
| V | Show / hide camera preview |
| O | Open a PDF (or drag one anywhere onto the page) |
| F | Fullscreen (hides your real browser so the mock one is all you see) |

Closing your eyes or looking away also pauses scrolling automatically.

## Demo script (about 90 seconds)

0. Press **F** for fullscreen. Start on the **Welcome to EyeSpye** tab, click **Try it on a reading →**,
   then click the EyeSpye icon in the toolbar.
1. **Start eye tracking**, then do the 5 calibration dots ("it's learning my eyes").
2. Hands behind your back. Read the first section; the page scrolls itself.
3. Point out the debug view: green paragraphs = read, the strip on the right = coverage map.
4. **Skim on purpose** through a middle section (e.g. "Testing yourself is a study strategy"). It turns red/orange.
5. Look up at the top of the screen: the page scrolls back so you can re-read (the red cue under the toolbar lights up).
6. Read the last section and look at **End of reading**. The report slides in with what you missed,
   the stats, key terms, and a check-yourself question. Click a "↳" link to jump back to that section.
7. Open the **Quiz** tab, answer a question, then **Export → PDF** to show the take-home study notes.
8. Bonus: drag a real PDF (a class reading) onto the page to show it works on anything.

## Demo-day checklist

- Light on your face from the front (window or lamp); avoid a bright window behind you.
- Maximize the browser window **before** calibrating, and don't resize afterward.
- Sit about an arm's length away, keep your head fairly still.
- If tracking is off, press **C** to recalibrate (takes 15 s).
- If the camera fails entirely, press **M**: mouse mode runs the exact same scrolling, coverage, and summary.
- Test your Wi-Fi / API key before going on stage. If the AI call fails you still get the offline summary.

## Tuning (live, from the browser console)

```js
eyespye.follow.triggerLine = 0.6   // where scrolling down starts (fraction of screen height)
eyespye.follow.maxSpeed = 9        // scroll-down speed when your eyes are at the bottom
eyespye.follow.upLine = 0.2        // top band that scrolls back up
eyespye.follow.upDwellMs = 600     // how long to look up before it scrolls back
eyespye.follow.upMaxSpeed = 8      // scroll-up speed at the very top
eyespye.coverage.setWpm(200)       // expected reading speed; lower = easier to count as "read"
eyespye.gaze.smoothing = 0.2       // lower = steadier gaze circle, higher = more responsive
```

Once you find values you like, change the defaults in `src/autoFollow.ts`, `src/coverage.ts`, and `src/gaze.ts`.

## Reading your own article or PDF

- **PDF:** drag it anywhere onto the page, or click **Open PDF**. Text-based PDFs work; scanned images don't
  (there's no text to extract). Two-column papers usually work; the reference list is skipped.
- **URL:** paste it on the start screen (or open `http://localhost:5173/?url=https://...`). The server extracts
  the article with Mozilla Readability.

## Credits

- [WebEyeTrack](https://github.com/RedForestAI/WebEyeTrack) (MIT): browser eye tracking
- [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0), [Readability](https://github.com/mozilla/readability) (Apache-2.0)
- [Claude API](https://platform.claude.com/): smart summaries and quizzes
