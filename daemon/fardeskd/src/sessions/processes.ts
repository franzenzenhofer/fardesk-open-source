const NO_SIGNAL = 0;

export function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, NO_SIGNAL);
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code === "EPERM") return true;
    if (code === "ESRCH") return false;
    throw error;
  }
}
