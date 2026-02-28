import type { AddressHeuristic } from "./types";
import { getAddressType } from "@/lib/bitcoin/address-type";

/**
 * H10: Address Type Analysis
 *
 * P2TR (Taproot) hides script complexity - single-sig, multisig, and
 * timelocks all look identical. Ideal for multisig/contracts.
 * P2WPKH (native SegWit) has the largest anonymity set - excellent for
 * single-sig. P2SH and P2PKH are worse for privacy.
 *
 * Impact: -5 to 0
 */
export const analyzeAddressType: AddressHeuristic = (address) => {
  const type = getAddressType(address.address);

  switch (type) {
    case "p2tr":
      return {
        findings: [
          {
            id: "h10-p2tr",
            severity: "good",
            title: "Taproot address (P2TR)",
            description:
              "Taproot hides script complexity - single-sig, multisig, and timelocks all look identical on-chain via key-path spends. " +
              "This is especially valuable for multisig and complex scripts. For single-sig, P2TR's anonymity set is currently smaller " +
              "than P2WPKH (native SegWit), which remains the most common address type.",
            recommendation:
              "Taproot is ideal for multisig and complex scripts. For single-sig wallets, P2WPKH (bc1q) currently offers a larger anonymity set. Both are acceptable choices.",
            scoreImpact: 0,
          },
        ],
      };

    case "p2wpkh":
      return {
        findings: [
          {
            id: "h10-p2wpkh",
            severity: "good",
            title: "Native SegWit address (P2WPKH)",
            description:
              "P2WPKH (native SegWit) has the largest anonymity set of any address type, making single-sig transactions highly private. " +
              "While it reveals the script type on spend, for single-sig this is not a privacy concern since the vast majority of P2WPKH users are single-sig.",
            recommendation:
              "P2WPKH has the largest anonymity set for single-sig transactions. No change needed.",
            scoreImpact: 0,
          },
        ],
      };

    case "p2wsh":
      return {
        findings: [
          {
            id: "h10-p2wsh",
            severity: "low",
            title: "Native SegWit multisig address (P2WSH)",
            description:
              "P2WSH is used for native SegWit multisig and complex scripts. The spending script is revealed on-chain when spent, which reduces privacy compared to Taproot where key-path spends hide the script.",
            recommendation:
              "Consider upgrading to a Taproot-based multisig setup (MuSig2 or FROST) for improved privacy.",
            scoreImpact: -2,
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
              "Upgrade to a Native SegWit (bc1q) wallet for the best anonymity set and lower fees.",
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
              "Upgrade to a Native SegWit (bc1q) wallet for the best anonymity set and lower fees.",
            scoreImpact: -5,
          },
        ],
      };

    default:
      return { findings: [] };
  }
};


