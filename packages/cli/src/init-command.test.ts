import { describe, expect, it } from "vitest";

import { eofSafeIo, type QuestionSource } from "./init-command.js";

/** Fake readline: scripted answers, then a question that never settles
 * (Node's readline/promises behavior when stdin closes mid-question). */
function fakeReadline(answers: string[]): QuestionSource & { close(): void } {
  let closeListener: (() => void) | undefined;
  return {
    question: () =>
      answers.length > 0 ? Promise.resolve(answers.shift()!) : new Promise<string>(() => {}),
    once: (_event, listener) => {
      closeListener = listener;
      return undefined;
    },
    close: () => closeListener?.(),
  };
}

describe("eofSafeIo (questionnaire EOF handling)", () => {
  it("passes real answers through untouched", async () => {
    const io = eofSafeIo(fakeReadline(["advisory"]), () => {});
    await expect(io.question("q1: ")).resolves.toBe("advisory");
  });

  it("HAZARD: a close during a pending question settles as the default with ONE stderr note", async () => {
    const notes: string[] = [];
    const rl = fakeReadline([]);
    const io = eofSafeIo(rl, (line) => notes.push(line));
    const pending = io.question("q1: "); // would hang forever un-wrapped
    rl.close(); // Ctrl+D
    await expect(pending).resolves.toBe("");
    // Every remaining question short-circuits, and the note prints once.
    await expect(io.question("q2: ")).resolves.toBe("");
    await expect(io.question("q3: ")).resolves.toBe("");
    expect(notes).toEqual(["input closed — accepting defaults for the remaining questions"]);
  });
});
