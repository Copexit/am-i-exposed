import { crc32 } from "./crc32";

// 256 words from BCR-2020-012, in byte-value order.
export const WORDS: string[] = "able acid also apex aqua arch atom aunt away axis back bald barn belt beta bias blue body brag brew bulb buzz calm cash cats chef city claw code cola cook cost crux curl cusp cyan dark data days deli dice diet door down draw drop drum dull duty each easy echo edge epic even exam exit eyes fact fair fern figs film fish fizz flap flew flux foxy free frog fuel fund gala game gear gems gift girl glow good gray grim guru gush gyro half hang hard hawk heat help high hill holy hope horn huts iced idea idle inch inky into iris iron item jade jazz join jolt jowl judo jugs jump junk jury keep keno kept keys kick kiln king kite kiwi knob lamb lava lazy leaf legs liar limp lion list logo loud love luau luck lung main many math maze memo menu meow mild mint miss monk nail navy need news next noon note numb obey oboe omit onyx open oval owls paid part peck play plus poem pool pose puff puma purr quad quiz race ramp real redo rich road rock roof ruby ruin runs rust safe saga scar sets silk skew slot soap solo song stub surf swan taco task taxi tent tied time tiny toil tomb toys trip tuna twin ugly undo unit urge user vast very veto vial vibe view visa void vows wall wand warm wasp wave waxy webs what when whiz wolf work yank yawn yell yoga yurt zaps zero zest zinc zone zoom".split(" ");
const MINIMAL = new Map(WORDS.map((w, i) => [w[0]! + w[3]!, i]));

/** Minimal bytewords (2 letters per byte) -> payload, verifying the trailing CRC32. */
export function decodeMinimalBytewords(s: string): Uint8Array {
  const text = s.toLowerCase();
  if (text.length % 2 !== 0 || text.length < 10) throw new Error("Invalid bytewords length");
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const v = MINIMAL.get(text.slice(i * 2, i * 2 + 2));
    if (v === undefined) throw new Error("Invalid byteword");
    bytes[i] = v;
  }
  const body = bytes.subarray(0, bytes.length - 4);
  const sum = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 4, 4).getUint32(0);
  if (crc32(body) !== sum) throw new Error("Bytewords checksum mismatch");
  return body;
}
