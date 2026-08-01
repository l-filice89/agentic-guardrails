// eval executes attacker-influenceable strings as code.
export function run(code: string): unknown {
  return eval(code);
}

// A string first argument to setTimeout is implied eval.
export function schedule(): void {
  setTimeout("run('1 + 1')", 10);
}
