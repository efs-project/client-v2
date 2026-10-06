export function assertBuildRuntime(expected: string, observed: string): void {
  if (observed !== expected) {
    throw new Error(`Build requires Node ${expected}; observed Node ${observed}`);
  }
}
