export class CliError extends Error {
  constructor(
    readonly code: string,
    readonly exitCode: number,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

export type Envelope = {
  contractVersion: 1;
  cliVersion: string;
  ok: boolean;
  command: string;
  tool?: string;
  execution: "not_attempted" | "response_received" | "unknown";
  result?: unknown;
  error?: { code: string; message: string; hint?: string };
};
export type Outcome =
  | { code: number; json: Envelope }
  | { code: number; text: string };
