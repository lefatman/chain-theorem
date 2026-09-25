/**
 * Magic-link mail (M4 4.1). `ConsoleMailSender` prints the link (local development and tests; no
 * account needed). `HttpMailSender` posts to a transactional email API when the human-only key
 * exists (DEPLOY.md). Both implement the same interface; nothing is faked.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailSender {
  send(msg: MailMessage): Promise<void>;
}

export class ConsoleMailSender implements MailSender {
  readonly sent: MailMessage[] = [];
  async send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
    console.log(`[mail] to ${msg.to}: ${msg.subject}\n${msg.text}`);
  }
}

/**
 * A provider with a JSON "send" endpoint and bearer-token auth (Resend, Postmark and similar accept
 * this shape: from, to, subject, text).
 */
export class HttpMailSender implements MailSender {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly from: string;
  constructor(endpoint: string, apiKey: string, from: string) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.from = from;
  }
  async send(msg: MailMessage): Promise<void> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: msg.to, subject: msg.subject, text: msg.text }),
    });
    if (!res.ok) throw new Error(`mail provider answered ${res.status}`);
  }
}

export function magicLinkMail(to: string, link: string, minutes: number): MailMessage {
  return {
    to,
    subject: 'Your Chain Theorem sign-in link',
    text: `Sign in to Chain Theorem:\n\n${link}\n\nThe link works once and expires in ${minutes} minutes. If you did not ask for it, ignore this email.`,
  };
}
