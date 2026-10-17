import "dotenv/config";
import express, { type Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { z } from "zod";

const PORT = 8787;
// ~100k tokens: plenty for long PDFs and research papers.
const MAX_INPUT_CHARS = 400_000;

const app = express();
app.use(express.json({ limit: "5mb" }));

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
const client = hasKey ? new Anthropic() : null;

app.get("/api/health", (_req, res) => {
  res.json({ ai: hasKey });
});

// ---------------------------------------------------------------------------
// Article loading: fetch a URL and reduce it to headings + paragraphs.
// Returning plain text blocks (not HTML) keeps the reader safe to render.
// ---------------------------------------------------------------------------
type Block = { type: "h" | "p"; text: string };

app.get("/api/article", async (req, res) => {
  const raw = String(req.query.url ?? "");
  let url: URL;
  try {
    url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    return res.status(400).json({ error: "Please enter a full http(s) URL." });
  }

  try {
    const page = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (EyeSpye demo reader)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!page.ok) return res.status(502).json({ error: `That site returned HTTP ${page.status}.` });

    const dom = new JSDOM(await page.text(), { url: url.toString() });
    const article = new Readability(dom.window.document).parse();
    if (!article?.content) return res.status(422).json({ error: "Couldn't find an article on that page." });

    const body = new JSDOM(article.content).window.document;
    const blocks: Block[] = [];
    for (const el of body.querySelectorAll("h1, h2, h3, h4, p, li, blockquote")) {
      // Skip nested matches (e.g. a <p> inside an <li>) so text isn't duplicated.
      if (el.parentElement?.closest("li, blockquote")) continue;
      const text = (el.textContent ?? "")
        .replace(/\[(\d+|citation needed|note \d+)\]/gi, "") // Wikipedia-style citation markers
        .replace(/\s+/g, " ")
        .trim();
      if (!text) continue;
      if (/^H[1-4]$/.test(el.tagName)) blocks.push({ type: "h", text });
      else if (text.length >= 40) blocks.push({ type: "p", text });
    }
    if (blocks.filter((b) => b.type === "p").length < 3) {
      return res.status(422).json({ error: "That page doesn't have enough article text." });
    }

    res.json({
      title: article.title || url.hostname,
      byline: [article.byline, article.siteName].filter(Boolean).join(" · "),
      blocks,
    });
  } catch (err) {
    console.error("[article]", err);
    res.status(502).json({ error: "Couldn't load that page." });
  }
});

// ---------------------------------------------------------------------------
// Shared request shape: every paragraph with its reading status.
// ---------------------------------------------------------------------------
const ParagraphIn = z.object({
  id: z.number().int(),
  heading: z.string(),
  text: z.string(),
  status: z.enum(["read", "skimmed", "skipped"]),
});
const ReadingRequest = z.object({
  title: z.string(),
  paragraphs: z.array(ParagraphIn).max(2000),
});

/**
 * One structured Claude call. Sends the error response itself and returns null on failure.
 */
async function askClaude<T extends z.ZodType>(
  res: Response,
  label: string,
  schema: T,
  system: string,
  userContent: string,
): Promise<z.infer<T> | null> {
  if (!client) {
    res.status(503).json({ error: "no_api_key" });
    return null;
  }
  if (userContent.length > MAX_INPUT_CHARS) {
    res.status(413).json({ error: "This reading is too long for the demo AI features." });
    return null;
  }
  try {
    const started = Date.now();
    const message = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: "user", content: userContent }],
    });
    if (message.stop_reason === "refusal") {
      res.status(422).json({ error: "The AI declined this request." });
      return null;
    }
    if (!message.parsed_output) {
      res.status(502).json({ error: "The AI response couldn't be read." });
      return null;
    }
    console.log(`[${label}] ${message.model} in ${Date.now() - started} ms`);
    return message.parsed_output as z.infer<T>;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      res.status(401).json({ error: "The API key was rejected. Check ANTHROPIC_API_KEY in .env." });
    } else if (err instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: "Rate limited. Try again in a moment." });
    } else if (err instanceof Anthropic.APIError) {
      console.error(`[${label}]`, err.status, err.message);
      res.status(502).json({ error: "The AI service had a problem." });
    } else {
      console.error(`[${label}]`, err);
      res.status(500).json({ error: "AI request failed." });
    }
    return null;
  }
}

function readingInput(title: string, paragraphs: z.infer<typeof ParagraphIn>[]): string {
  return `Reading title: ${title}\n\nParagraphs (JSON):\n${JSON.stringify(paragraphs)}`;
}

// ---------------------------------------------------------------------------
// Smart summary: Claude summarizes only what the reader skipped or skimmed.
// ---------------------------------------------------------------------------
const MissedSummary = z.object({
  headline: z.string(),
  points: z.array(
    z.object({
      paragraphIds: z.array(z.number().int()),
      status: z.enum(["skipped", "skimmed"]),
      text: z.string(),
    }),
  ),
  keyTerms: z.array(z.object({ term: z.string(), definition: z.string() })),
  checkQuestion: z.string(),
});

const SUMMARY_PROMPT = `You are EyeSpye, a reading assistant for students and researchers.
EyeSpye tracked the reader's eyes while they read. Every paragraph is labeled "read", "skimmed", or "skipped".
Write a catch-up summary of the skipped and skimmed paragraphs so the reader can fill the gaps without rereading everything.

Rules:
- Use only information stated in the provided paragraphs. Never add outside facts.
- Prioritize what a student would be tested on: definitions, findings, names, dates, numbers, methods, and caveats.
- Skipped paragraphs get more detail than skimmed ones. Paragraphs marked "read" are context only; do not summarize them.
- Write 3 to 6 points. Each point is 1-2 plain sentences and lists the ids of the paragraphs it covers.
- headline: one sentence telling the reader what they mostly missed.
- keyTerms: up to 4 important terms that appear in the missed paragraphs, with short definitions taken from the text. Use an empty list if there are none.
- checkQuestion: one short question the reader could answer only by knowing the missed material.
- Write for a high school or college student: clear, concise, no filler.`;

app.post("/api/summarize", async (req, res) => {
  const parsed = ReadingRequest.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Bad request" });
  const { title, paragraphs } = parsed.data;
  if (!paragraphs.some((p) => p.status !== "read")) return res.status(400).json({ error: "Nothing was missed." });

  const out = await askClaude(res, "summarize", MissedSummary, SUMMARY_PROMPT, readingInput(title, paragraphs));
  if (out) res.json(out);
});

// ---------------------------------------------------------------------------
// Quiz: multiple choice, weighted toward the sections the reader missed.
// ---------------------------------------------------------------------------
const Quiz = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
      answerIndex: z.number().int(),
      explanation: z.string(),
      paragraphId: z.number().int(),
      fromMissed: z.boolean(),
    }),
  ),
});

const QUIZ_PROMPT = `You are EyeSpye, a reading assistant for students and researchers.
EyeSpye tracked the reader's eyes while they read. Every paragraph is labeled "read", "skimmed", or "skipped".
Write a 5-question multiple-choice quiz that checks whether the reader understood the reading.

Rules:
- Use only information stated in the provided paragraphs. Never add outside facts.
- At least 3 questions must come from "skipped" or "skimmed" paragraphs (set fromMissed: true). The rest come from "read" paragraphs (fromMissed: false). If nothing was missed, draw from the whole reading.
- Test understanding — what a concept means, why something happens, how ideas connect, or which finding supports a claim — not trivial wording.
- Exactly 4 options per question with exactly one correct answer. Distractors must be plausible and similar in length to the correct answer. Vary the position of the correct answer (answerIndex is 0-3).
- explanation: 1-2 sentences explaining why the answer is correct, based on the reading.
- paragraphId: the id of the paragraph that contains the answer.
- Write for a high school or college student.`;

app.post("/api/quiz", async (req, res) => {
  const parsed = ReadingRequest.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Bad request" });
  const { title, paragraphs } = parsed.data;

  const out = await askClaude(res, "quiz", Quiz, QUIZ_PROMPT, readingInput(title, paragraphs));
  if (!out) return;
  const ids = new Set(paragraphs.map((p) => p.id));
  const questions = out.questions.filter(
    (q) => q.options.length === 4 && q.answerIndex >= 0 && q.answerIndex < 4 && ids.has(q.paragraphId),
  );
  if (questions.length === 0) return res.status(502).json({ error: "The AI quiz came back empty." });
  res.json({ questions });
});

app.listen(PORT, () => {
  console.log(`EyeSpye API on http://localhost:${PORT}  (AI: ${hasKey ? "on" : "OFF - add ANTHROPIC_API_KEY to .env"})`);
});
