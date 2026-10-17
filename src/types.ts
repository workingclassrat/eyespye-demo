export type Block = { type: "h" | "p"; text: string };

export interface Article {
  title: string;
  byline: string;
  blocks: Block[];
}

export type ReadStatus = "unseen" | "skipped" | "skimmed" | "read";

export interface SummaryPoint {
  paragraphIds: number[];
  status: "skipped" | "skimmed";
  text: string;
}

export interface MissedSummary {
  headline: string;
  points: SummaryPoint[];
  keyTerms: { term: string; definition: string }[];
  checkQuestion: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  paragraphId: number;
  fromMissed: boolean;
}
