/**
 * Chat safety (R-SEC-011, COMMITTED): a conversation is filtered according to its youngest
 * participant. Any under-18 participant filters it for everyone; adults-only conversations are
 * unfiltered unless an adult turns the filter on for themselves; whispers to or from a minor are
 * limited to friends. The word list sits behind `ChatFilter` (BUILD_PROMPT M5: a curated list behind
 * an interface) so production can swap in a larger list without touching the zone core.
 */

export interface ChatFilter {
  /** The text with blocked words and contact details masked. Must be idempotent. */
  clean(text: string): string;
}

/** Who takes part in a conversation, as far as filtering is concerned. */
export interface Participant {
  adult: boolean;
}

export interface Viewer extends Participant {
  /** The adult's own opt-in filter. */
  filterChat: boolean;
}

export interface WhisperParty {
  id: string;
  adult: boolean;
  friends: readonly string[];
}

/** R-SEC-011: filtered for everyone when any participant is under 18. */
export function conversationFiltered(participants: Iterable<Participant>): boolean {
  for (const p of participants) if (!p.adult) return true;
  return false;
}

/** What one viewer sees: the conversation's level, or filtered because they asked for it. */
export function viewFiltered(conversation: boolean, viewer: Viewer): boolean {
  return conversation || !viewer.adult || viewer.filterChat;
}

/** Whispers to or from a minor need friendship both ways (R-SEC-011, PROVISIONAL). */
export function whisperAllowed(from: WhisperParty, to: WhisperParty): boolean {
  if (from.id === to.id) return false;
  if (from.adult && to.adult) return true;
  return from.friends.includes(to.id) && to.friends.includes(from.id);
}

/**
 * Turn control characters into spaces, drop zero-width and bidirectional-override characters (they
 * hide words from the filter and spoof the display) and collapse whitespace.
 */
export function sanitizeText(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) out += ' ';
    else if (
      (c >= 0x200b && c <= 0x200f) ||
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0x2060 && c <= 0x2069) ||
      c === 0xfeff
    )
      continue;
    else out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

// ---- The default list (small, original, English) -----------------------------------------------

/** Roots blocked anywhere inside a word (they rarely occur inside innocent words). */
const ANYWHERE = ['fuck', 'shit', 'fagg', 'whore', 'bitch', 'porn', 'slut'];

/** Words blocked alone or with a common ending (s, ed, ing, y, ...). */
const WORDS = [
  'ass',
  'asshole',
  'arse',
  'bastard',
  'bollock',
  'cock',
  'crap',
  'cunt',
  'damn',
  'dick',
  'dildo',
  'douche',
  'fag',
  'jerkoff',
  'kys',
  'nigga',
  'nigger',
  'nude',
  'piss',
  'prick',
  'pussy',
  'rape',
  'retard',
  'sex',
  'sexy',
  'sext',
  'tit',
  'tits',
  'twat',
  'wank',
  'wanker',
  // Off-platform contact (grooming risk in conversations with minors).
  'snapchat',
  'whatsapp',
  'telegram',
  'kik',
  'discord',
  'insta',
  'instagram',
];
const ENDINGS = [
  '',
  's',
  'es',
  'ed',
  'er',
  'ers',
  'ing',
  'in',
  'y',
  'ie',
  'bag',
  'head',
  'face',
  'hole',
];
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i',
  '+': 't',
};

const URL_RE =
  /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\s?(?:\.|\(dot\)|\[dot\])\s?(?:com|net|org|io|gg|co|me|tv|app|dev|xyz|info|biz|ly|link|site|online|ru|uk|us|de|fr|ca|au)\b(?:\/\S*)?/gi;
const EMAIL_RE =
  /[a-z0-9._%+-]+\s?(?:@|\(at\)|\[at\])\s?[a-z0-9-]+(?:\s?(?:\.|\(dot\)|\[dot\])\s?[a-z0-9-]+)+/gi;
/** Seven or more digits with separators: a phone number or similar contact detail. */
const PHONE_RE = /\+?\d(?:[\s().-]{0,3}\d){6,}/g;
const MASK = '***';

function normalize(token: string): string {
  let s = '';
  for (const ch of token.toLowerCase()) s += LEET[ch] ?? ch;
  return s.replace(/[^a-z]/g, '');
}

/** "fuuuuck" -> "fuck": runs of one letter collapse to one. */
const squeeze = (s: string): string => s.replace(/([a-z])\1+/g, '$1');

function blockedWord(word: string): boolean {
  if (word === '') return false;
  for (const root of ANYWHERE) if (word.includes(root)) return true;
  for (const w of WORDS) {
    if (!word.startsWith(w)) continue;
    if (ENDINGS.includes(word.slice(w.length))) return true;
  }
  return false;
}

export function isBlocked(token: string): boolean {
  const n = normalize(token);
  return blockedWord(n) || blockedWord(squeeze(n));
}

/** Letters spelled out one at a time ("s h i t", "s.h.i.t"). */
const SPACED_RE = /(?<=^|\s)(?:\S[ ._-]){2,}\S(?=\s|$)/g;
/** Punctuation around a word stays visible: "shit," becomes "****,". */
const EDGES_RE = /^([("'[]*)(.*?)([.,;:?!)"'\]]*)$/s;

function mask(token: string): string {
  const m = EDGES_RE.exec(token);
  const [lead, core, trail] = m ? [m[1] ?? '', m[2] ?? '', m[3] ?? ''] : ['', token, ''];
  return core === '' ? '*'.repeat(token.length) : lead + '*'.repeat(core.length) + trail;
}

/** The default filter: contact details masked, blocked words replaced by asterisks. */
export const basicChatFilter: ChatFilter = {
  clean(text: string): string {
    const masked = text
      .replace(EMAIL_RE, MASK)
      .replace(URL_RE, MASK)
      .replace(PHONE_RE, MASK)
      .replace(SPACED_RE, (run) =>
        isBlocked(run.replace(/[ ._-]/g, '')) ? run.replace(/[^ ._-]/g, '*') : run,
      );
    return masked
      .split(/(\s+)/)
      .map((tok) => (/\s/.test(tok) || tok === MASK || !isBlocked(tok) ? tok : mask(tok)))
      .join('');
  },
};
