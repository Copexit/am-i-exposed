import type { AddressHeuristic } from "./types";
import type { AddressType } from "@/lib/types";

/**
 * H10: Address Type Analysis
 *
 * P2TR (Taproot) offers the best privacy -- all spends look identical
 * regardless of underlying script complexity. P2WPKH (native SegWit) is
 * the next best. P2SH and P2PKH are worse for privacy.
 *
 * Impact: -5 to +5
 */
export const analyzeAddressType: AddressHeuristic = (address) => {
  const type = detectAddressType(address.address);

  switch (type) {
    case "p2tr":
      return {
        findings: [
          {
            id: "h10-p2tr",
            severity: "good",
            title: "Taproot address (P2TR)",
            description:
              "Taproot addresses provide the best on-chain privacy. All spend conditions (single-sig, multisig, timelocks) look identical on-chain, making transactions indistinguishable from each other.",
            recommendation:
              "You are using the most private address type available. Encourage others to adopt Taproot to grow the anonymity set.",
            scoreImpact: 5,
          },
        ],
      };

    case "p2wpkh":
      return {
        findings: [
          {
            id: "h10-p2wpkh",
            severity: "low",
            title: "Native SegWit address (P2WPKH)",
            description:
              "P2WPKH is a good choice with a large anonymity set, but Taproot (P2TR) offers stronger privacy because all spend types look identical.",
            recommendation:
              "Consider upgrading to a Taproot-capable wallet for improved privacy.",
            scoreImpact: 0,
          },
        ],
      };

    case "p2sh":
      return {
        findings: [
          {
            id: "h10-p2sh",
            severity: "medium",
            title: "Pay-to-Script-Hash address (P2SH)",
            description:
              "P2SH addresses reveal their script type on spend, reducing privacy. They also have a smaller anonymity set than native SegWit or Taproot addresses.",
            recommendation:
              "Upgrade to a native SegWit (bc1q) or Taproot (bc1p) wallet.",
            scoreImpact: -3,
          },
        ],
      };

    case "p2pkh":
      return {
        findings: [
          {
            id: "h10-p2pkh",
            severity: "medium",
            title: "Legacy address (P2PKH)",
            description:
              "Legacy P2PKH addresses reveal the public key when spent, and have higher fees. While they have a large historical anonymity set, modern privacy tools and CoinJoin protocols primarily use newer address types.",
            recommendation:
              "Upgrade to a native SegWit (bc1q) or Taproot (bc1p) wallet for better privacy and lower fees.",
            scoreImpact: -5,
          },
        ],
      };

    default:
      return { findings: [] };
  }
};

function detectAddressType(addr: string): AddressType {
  if (addr.startsWith("bc1p") || addr.startsWith("tb1p")) return "p2tr";
  if (addr.startsWith("bc1q") || addr.startsWith("tb1q")) return "p2wpkh";
  if (addr.startsWith("3") || addr.startsWith("2")) return "p2sh";
  if (addr.startsWith("1") || addr.startsWith("m") || addr.startsWith("n"))
    return "p2pkh";
  return "unknown";
}
