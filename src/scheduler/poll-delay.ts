/** Random delay in seconds after the previous check finishes (25–45 inclusive). */
export const nextPollDelay = (): number => 25 + Math.floor(Math.random() * 21);
