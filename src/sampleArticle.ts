import type { Article } from "./types";

// Original sample article written for the EyeSpye demo. It is text-heavy on purpose and
// contains concrete names, dates, and definitions so a "what you missed" summary has substance.
export const SAMPLE_ARTICLE: Article = {
  title: "Why You Forget What You Study — and What the Research Says to Do About It",
  byline: "EyeSpye sample reading · about 8 minutes",
  blocks: [
    { type: "p", text: "Most students have had the experience of reading a chapter carefully, feeling confident, and then blanking on the same material during a test a week later. This is not a personal failing. It is how human memory is built to work, and over more than a century researchers have mapped out both why forgetting happens and which study habits slow it down." },

    { type: "h", text: "Three stages of memory" },
    { type: "p", text: "Psychologists usually describe memory as three stages. Encoding is the moment information first enters the brain and is turned into a form that can be stored. Storage is how that information is kept over time. Retrieval is the act of pulling it back out when you need it. A failure at any stage looks the same to you — you \"forgot\" — but the fixes are different, which is why good study strategies target specific stages." },
    { type: "p", text: "Encoding is limited by working memory, the small mental workspace that holds what you are actively thinking about. In 1956 psychologist George Miller famously described its capacity as \"the magical number seven, plus or minus two\" items. Later work by Nelson Cowan suggested the true limit is closer to about four meaningful chunks. Either way, the workspace is small, which is why reading while juggling other tasks leaves so little room for new information to be encoded." },

    { type: "h", text: "The forgetting curve" },
    { type: "p", text: "The first careful measurements of forgetting came from German psychologist Hermann Ebbinghaus, who published his results in 1885. Ebbinghaus memorized lists of nonsense syllables such as \"WID\" and \"ZOF\" so that prior knowledge would not help him, then tested himself after different delays. He found that memory drops steeply in the first hours and days after learning and then levels off. This pattern became known as the forgetting curve." },
    { type: "p", text: "Ebbinghaus also discovered a way to bend the curve. Each time he relearned a list, it took less effort than the time before, and the material faded more slowly afterward. Reviewing information is not wasted work even when it feels like you are relearning from scratch: every review leaves the memory stronger and longer lasting." },

    { type: "h", text: "Spacing beats cramming" },
    { type: "p", text: "The spacing effect is one of the most reliable findings in learning research. Studying the same material in several shorter sessions spread over days produces better long-term memory than studying it for the same total time in one long session. Cramming the night before can work for a test the next morning, but much of that material is lost within days because it was never revisited after the first steep drop of the forgetting curve." },
    { type: "p", text: "One explanation is that a little forgetting between sessions is actually useful. When you return to material after a gap, your brain has to work harder to reconstruct it, and that effort strengthens the memory. Researchers call this kind of productive struggle a desirable difficulty, a term popularized by psychologist Robert Bjork." },

    { type: "h", text: "Testing yourself is a study strategy" },
    { type: "p", text: "Retrieval practice means deliberately recalling information from memory — with flashcards, practice questions, or by writing down everything you remember — instead of rereading it. In a widely cited 2006 study, Henry Roediger and Jeffrey Karpicke had students read short passages and then either restudy them or take recall tests on them. Students who restudied did slightly better on a test five minutes later, but students who practiced retrieval remembered substantially more one week later." },
    { type: "p", text: "Rereading is popular partly because of the illusion of fluency. Text you have already seen feels familiar, and familiarity is easy to mistake for understanding. Retrieval practice exposes the gaps that rereading hides: if you cannot explain an idea without looking, you do not know it yet, no matter how familiar the page looks." },

    { type: "h", text: "Mixing it up: interleaving" },
    { type: "p", text: "Most textbooks group practice problems by type, so students solve ten problems of one kind before moving to the next. This is called blocked practice. Interleaved practice mixes different problem types together. In a 2007 study of math learning, Doug Rohrer and Kelli Taylor found that students who practiced interleaved problems performed worse during practice but much better on a later test, because they had to learn to identify which strategy each problem needed." },

    { type: "h", text: "Sleep and consolidation" },
    { type: "p", text: "Memories are not stored in their final form the moment they are encoded. Through a process called consolidation, the brain stabilizes new memories over the following hours and days, and much of this work happens during sleep. During deep sleep, the hippocampus — a brain structure central to forming new memories — appears to replay recent experiences, helping transfer them into longer-term storage. Pulling an all-nighter skips this step, which is one reason crammed material fades so quickly." },

    { type: "h", text: "The cost of switching tasks" },
    { type: "p", text: "Many students study with a phone nearby, several browser tabs open, and notes in another window. Research on task switching shows that each switch carries a cost: the brain needs time to disengage from one task and re-orient to another, and errors increase. Because working memory is so limited, constant switching also means less information is encoded in the first place. What feels like efficient multitasking is usually rapid switching with a hidden penalty." },
    { type: "p", text: "Skimming creates a related problem. Readers under time pressure tend to jump between headings and the first lines of paragraphs, which can give a reasonable sense of the topic while missing definitions, exceptions, and details that sit in the middle of paragraphs — exactly the material that tends to appear on exams and in research methods sections." },

    { type: "h", text: "Putting it together" },
    { type: "p", text: "A study plan built on this research is simple to describe, even if it takes discipline to follow. Spread study sessions across several days instead of one long block. Spend most of each session recalling and testing rather than rereading. Mix different types of problems once the basics are familiar. Protect your sleep, especially before an exam. And reduce switching by closing unneeded tabs and keeping your attention on one source at a time." },
    { type: "p", text: "None of these strategies feel as comfortable as rereading highlighted notes, and that is the point. The techniques that produce lasting learning usually feel harder in the moment. The forgetting curve that Ebbinghaus measured in 1885 still applies to every student today, but it is not destiny: how and when you review determines how much of what you read is still there when you need it." },
  ],
};
