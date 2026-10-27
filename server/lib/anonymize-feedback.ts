const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RE = /\bhttps?:\/\/\S+/gi;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const SLACK_MENTION_RE = /<@U[A-Z0-9]{6,}>/g;
const AT_HANDLE_RE = /(^|\s)@[a-z0-9._-]{2,}/gi;

export function anonymizeFeedback(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(EMAIL_RE, "[email]")
    .replace(URL_RE, "[url]")
    .replace(SLACK_MENTION_RE, "[user]")
    .replace(AT_HANDLE_RE, "$1[handle]")
    .replace(PHONE_RE, "[phone]");
}
