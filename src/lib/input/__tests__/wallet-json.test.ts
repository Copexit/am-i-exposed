import { describe, it, expect } from "vitest";
import { p2wpkh, NETWORK, TEST_NETWORK } from "@scure/btc-signer";
import { descriptorChecksum, parseAndDerive } from "@/lib/bitcoin/descriptor";
import { coldcardJson } from "./fixtures";
import { walletJsonToPayload, MULTISIG } from "../wallet-json";

const firstReceive = (acct: { deriveChild: (i: number) => { deriveChild: (i: number) => { publicKey: Uint8Array | null } } }, testnet = false) =>
  p2wpkh(acct.deriveChild(0).deriveChild(0).publicKey!, testnet ? TEST_NETWORK : NETWORK).address;
const withSum = (body: string) => `${body}#${descriptorChecksum(body)}`;

describe("walletJsonToPayload", () => {
  it("Coldcard Generic JSON without desc -> bip84 descriptor built from xfp + deriv + xpub", () => {
    const { json, xfp, accounts } = coldcardJson();
    const out = walletJsonToPayload(JSON.stringify(json));
    expect(out).toBe(withSum(`wpkh([${xfp.toLowerCase()}/84h/0h/0h]${accounts.bip84!.publicExtendedKey}/<0;1>/*)`));
    const parsed = parseAndDerive(out!, 2);
    expect(parsed.scriptType).toBe("p2wpkh");
    expect(parsed.network).toBe("mainnet");
    expect(parsed.receiveAddresses[0]?.address).toBe(firstReceive(accounts.bip84!));
    expect(parsed.changeAddresses).toHaveLength(2);
  });

  it("Coldcard Generic JSON with desc -> its bip84 desc verbatim", () => {
    const { json } = coldcardJson({ desc: true });
    expect(walletJsonToPayload(JSON.stringify(json, null, 2))).toBe((json.bip84 as { desc: string }).desc);
  });

  it("Coldcard desc with a bad checksum -> descriptor rebuilt from xfp/deriv/xpub", () => {
    const { json, xfp, accounts } = coldcardJson({ desc: true });
    const sec = json.bip84 as { desc: string };
    sec.desc = sec.desc.replace(/#.*/, "#aaaaaaaa");
    const out = walletJsonToPayload(JSON.stringify(json))!;
    expect(out).toBe(withSum(`wpkh([${xfp.toLowerCase()}/84h/0h/0h]${accounts.bip84!.publicExtendedKey}/<0;1>/*)`));
    expect(parseAndDerive(out, 1).receiveAddresses[0]?.address).toBe(firstReceive(accounts.bip84!));
  });

  it("falls through bip84 -> bip86 -> bip49 -> bip44", () => {
    const { json } = coldcardJson({ desc: true });
    delete json.bip84;
    expect(walletJsonToPayload(JSON.stringify(json))).toMatch(/^tr\(/);
    delete json.bip86;
    const sh = walletJsonToPayload(JSON.stringify(json))!;
    expect(sh).toMatch(/^sh\(wpkh\(/);
    expect(parseAndDerive(sh, 1).scriptType).toBe("p2sh-p2wpkh");
    delete json.bip49;
    expect(walletJsonToPayload(JSON.stringify(json))).toMatch(/^pkh\(/);
  });

  it("testnet XTN export with tpubs -> testnet wallet", () => {
    const { json, accounts } = coldcardJson({ testnet: true });
    const out = walletJsonToPayload(JSON.stringify(json))!;
    expect(out).toMatch(/^wpkh\(\[[0-9a-f]{8}\/84h\/1h\/0h\]tpub/);
    const parsed = parseAndDerive(out, 1);
    expect(parsed.network).toBe("testnet");
    expect(parsed.receiveAddresses[0]?.address).toBe(firstReceive(accounts.bip84!, true));
  });

  it("multisig-only exports -> MULTISIG; single-sig wins when both are present", () => {
    const { json, master, xfp } = coldcardJson({ withMultisig: true });
    expect(walletJsonToPayload(JSON.stringify(json))).toMatch(/^wpkh\(/);
    for (const k of ["bip44", "bip49", "bip84", "bip86"]) delete json[k];
    expect(walletJsonToPayload(JSON.stringify(json))).toBe(MULTISIG);
    // Coldcard multisig xpub export (Settings > Multisig > Export XPUB)
    const ms = master.derive("m/48'/0'/0'/2'").publicExtendedKey;
    expect(walletJsonToPayload(JSON.stringify({ xfp, p2wsh_deriv: "m/48'/0'/0'/2'", p2wsh: ms, p2sh_p2wsh: ms }))).toBe(MULTISIG);
    // Bitcoin Core multisig descriptors
    expect(walletJsonToPayload(JSON.stringify({ descriptors: [{ desc: `wsh(sortedmulti(2,${ms}/0/*,${ms}/1/*))#aaaaaaaa`, internal: false }] }))).toBe(MULTISIG);
    expect(walletJsonToPayload(JSON.stringify([{ desc: `sh(multi(1,${ms}/0/*))` }]))).toBe(MULTISIG);
    // Electrum 2-of-3
    expect(walletJsonToPayload(JSON.stringify({ wallet_type: "2of3", "x1/": { xpub: ms }, "x2/": { xpub: ms } }))).toBe(MULTISIG);
    expect(walletJsonToPayload(JSON.stringify({ wallet_type: "standard" }))).toBeNull();
    // Arbitrary JSON with look-alike keys is not a wallet export
    expect(walletJsonToPayload(JSON.stringify({ p2sh_foo: 1 }))).toBeNull();
    expect(walletJsonToPayload(JSON.stringify({ bip48_1: "x" }))).toBeNull();
    expect(walletJsonToPayload(JSON.stringify([{ desc: "multi(1,abc)" }]))).toBeNull();
    expect(walletJsonToPayload(JSON.stringify({ wallet_type: "2of3" }))).toBeNull();
  });

  it("never returns private keys", () => {
    const { master, json } = coldcardJson();
    const xprv = master.derive("m/84'/0'/0'").privateExtendedKey;
    const leaky = {
      ...json,
      bip84: { deriv: "m/84'/0'/0'", xpub: xprv, xprv, desc: `wpkh(${xprv}/<0;1>/*)` },
      bip86: undefined, bip49: undefined, bip44: undefined,
    };
    expect(walletJsonToPayload(JSON.stringify(leaky))).toBeNull();
    expect(walletJsonToPayload(JSON.stringify({ keystore: { xpub: xprv, xprv } }))).toBeNull();
    expect(walletJsonToPayload(JSON.stringify({ ExtPubKey: xprv }))).toBeNull();
    expect(walletJsonToPayload(JSON.stringify([{ desc: `wpkh(${xprv}/0/*)` }]))).toBeNull();
  });

  it("Bitcoin Core listdescriptors -> preferred non-internal desc, widened to both chains", () => {
    const { xfp, accounts } = coldcardJson();
    const fp = xfp.toLowerCase();
    const d = (wrap: string, purpose: number, chain: number, internal: boolean) => ({
      desc: withSum(`${wrap}[${fp}/${purpose}'/0'/0']${accounts[`bip${purpose}`]!.publicExtendedKey}/${chain}/*${wrap === "sh(wpkh(" ? "))" : ")"}`),
      timestamp: 1, active: true, internal, range: [0, 999], next: 0,
    });
    const list = [d("pkh(", 44, 0, false), d("pkh(", 44, 1, true), d("wpkh(", 84, 1, true), d("wpkh(", 84, 0, false)];
    const want = withSum(`wpkh([${fp}/84'/0'/0']${accounts.bip84!.publicExtendedKey}/<0;1>/*)`);
    expect(walletJsonToPayload(JSON.stringify(list))).toBe(want);
    expect(walletJsonToPayload(JSON.stringify({ wallet_name: "w", descriptors: list }))).toBe(want);
    expect(parseAndDerive(want, 1).changeAddresses).toHaveLength(1);
    // A corrupted checksum is passed through for the parser to report, never replaced.
    const bad = { desc: d("wpkh(", 84, 0, false).desc.replace(/#.*/, "#aaaaaaaa") };
    expect(walletJsonToPayload(JSON.stringify([bad]))).toBe(bad.desc);
  });

  it("Electrum keystore.xpub (zpub) -> the zpub", () => {
    const zpub = "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
    expect(walletJsonToPayload(JSON.stringify({ keystore: { type: "bip32", xpub: zpub, root_fingerprint: "73c5da0a" }, wallet_type: "standard" }))).toBe(zpub);
  });

  it("Wasabi ExtPubKey -> native segwit descriptor", () => {
    const { accounts } = coldcardJson();
    const xpub = accounts.bip84!.publicExtendedKey;
    const out = walletJsonToPayload(JSON.stringify({ ExtPubKey: xpub, MasterFingerprint: "4f8ef4a2", AccountKeyPath: "84'/0'/0'" }))!;
    expect(out).toBe(`wpkh(${xpub})`);
    expect(parseAndDerive(out, 1).receiveAddresses[0]?.address).toBe(firstReceive(accounts.bip84!));
  });

  it("not JSON, or JSON without a usable key -> null", () => {
    expect(walletJsonToPayload("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBeNull();
    expect(walletJsonToPayload("{nope")).toBeNull();
    expect(walletJsonToPayload("{}")).toBeNull();
    expect(walletJsonToPayload("[1,2]")).toBeNull();
  });
});
