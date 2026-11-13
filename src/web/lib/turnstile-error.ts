/** Why no token came: the script could not load at all, or the check did not pass. */
export class TurnstileError extends Error {
  readonly unavailable: boolean
  constructor(unavailable: boolean) {
    super(unavailable ? 'Turnstile could not load' : 'Turnstile check failed')
    this.unavailable = unavailable
  }
}
