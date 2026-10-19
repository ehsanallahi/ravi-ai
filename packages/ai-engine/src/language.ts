/** Language and script of a customer message or a reply. */
export type ReplyLanguage = "english" | "urdu" | "roman_urdu" | "other";

const ARABIC_SCRIPT_LETTER = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/gu;
const LATIN_LETTER = /[A-Za-z\u00C0-\u024F]/g;

/** Words that are (almost) never English: one is enough to tell Roman Urdu apart. */
const ROMAN_URDU_STRONG = new Set(
  (
    "hai hain hoga hogi honge kya kia kyun kyon kaise kaisa kaisi kab kahan kidhar kitna kitne kitni kaun konsa konsi " +
    "aap aapka aapki aapke apka apki apke hamara hamari hamare humara humare mujhe mera meri mere tumhara " +
    "nahi nahin nhi haan jee chahiye chahta chahti chahte sakta sakti sakte batain batayein bataen bataiye " +
    "karein karen karna karte karta karti kijiye dijiye dein milega milegi milenge raha rahi rahe tha thi " +
    "liye wala wali wale abhi yahan wahan agar lekin magar sirf bohat bahut zyada kam qeemat keemat"
  ).split(" "),
);

/** Common Roman Urdu words that are short or ambiguous; they only add to a strong signal. */
const ROMAN_URDU_WEAK = new Set(
  "ka ki ke ko se mein me ye yeh wo woh aur ho hum ham bhi kar din ji acha accha theek".split(" "),
);

function romanUrduScore(text: string): { strong: number; weak: number } {
  let strong = 0;
  let weak = 0;
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (ROMAN_URDU_STRONG.has(word)) strong++;
    else if (ROMAN_URDU_WEAK.has(word)) weak++;
  }
  return { strong, weak };
}

/**
 * Deterministic language/script detection used to decide the reply language from the message
 * being answered (not from older messages or the model's own label):
 * - Urdu script when at least 30% of letters are Arabic-script (brand names stay in Latin);
 * - Roman Urdu when Latin text contains a clearly Urdu word ("kya", "hain", "aap", …);
 * - English for other Latin text; "other" when there are no letters (emoji, numbers).
 */
export function detectLanguage(text: string): ReplyLanguage {
  const arabic = text.match(ARABIC_SCRIPT_LETTER)?.length ?? 0;
  const latin = text.match(LATIN_LETTER)?.length ?? 0;
  if (arabic + latin === 0) return "other";
  if (arabic / (arabic + latin) >= 0.3) return "urdu";
  const { strong, weak } = romanUrduScore(text);
  if (strong >= 1 && strong * 2 + weak >= 2) return "roman_urdu";
  return "english";
}

/**
 * True when `reply` is in the language and script the customer used. Only the cases that matter
 * are enforced: Urdu must be answered in Urdu script, Roman Urdu in Roman Urdu (Latin-script
 * English is not accepted), and Latin-script messages must not get an Urdu-script answer.
 */
export function replyMatchesLanguage(expected: ReplyLanguage, reply: string): boolean {
  const actual = detectLanguage(reply);
  if (expected === "urdu" || expected === "roman_urdu") return actual === expected;
  if (expected === "english") return actual !== "urdu";
  return true;
}
