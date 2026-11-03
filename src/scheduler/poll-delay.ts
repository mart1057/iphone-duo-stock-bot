/** Delay after each completed check, using Bangkok time independently of host TZ. */
export const nextPollDelay = (now = Date.now()): number => {
  const hour = new Date(now + 7 * 60 * 60_000).getUTCHours();
  return hour === 8 ? 10 + Math.floor(Math.random() * 6) : 30;
};
