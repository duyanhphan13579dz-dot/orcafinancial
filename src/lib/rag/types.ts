/** ORCA Agent RAG — playbook chunk types. */

export type PlaybookDomain = "pf" | "dn" | "wealth";

export interface PlaybookChunk {
  id: string;
  domain: PlaybookDomain;
  title: string;
  /** Search keywords (Vietnamese + English, lowercase tokens). */
  keywords: string[];
  /** Expert guidance injected into LLM context (not shown raw to user). */
  body: string;
}

export interface RetrievedChunk {
  chunk: PlaybookChunk;
  score: number;
}
