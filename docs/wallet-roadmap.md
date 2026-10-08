# Wallet roadmap: from privacy scanner to privacy-first watch-only wallet

Goal: a user with a hardware signer can receive, choose coins and spend from am-i.exposed without needing Sparrow, with privacy analysis built into every step. Keys never touch the browser: am-i.exposed stays a watch-only coordinator, and the hardware signer signs.

## Already in place

| Area | What exists |
|---|---|
| Watch-only wallet | xpub/zpub/tpub and single-sig descriptors, gap limit up to 1000, script-type detection, backend network detection |
| Coins | UTXO list, on-chain links, BIP329 labels (import/export, Sparrow-compatible), freezing |
| Coin control | Ranked plans, manual selection, small change to miners, spending decision tree with recipient checks |
| Persistence | Saved wallets with quick refresh, opt-in wallet bookmarks |
| Transactions | PSBT parsing and privacy analysis before sending (Before You Send), opt-in broadcast |
| Signer I/O | Animated QR scanning: BBQr (Coldcard) and UR (Keystone, Passport, Jade, SeedSigner) |
| Backends | mempool.space, own node (Umbrel/StartOS/custom URL), Tor |

`@scure/btc-signer` is already a dependency, so building PSBTs needs no new library.

## Phase 1: spend MVP (single-sig)

1. **Wallet import with key origin.** A bare xpub has no master fingerprint or derivation path, and signers need both to sign. Import:
   - Coldcard generic JSON;
   - descriptors with `[fingerprint/path]`;
   - UR `crypto-account` / `crypto-output` QR;
   - a Sparrow wallet export.
2. **Build the PSBT from a plan.** "Create transaction" on any coin-selector plan or manual selection:
   - outputs, plus change to the next unused change address;
   - fee rate, RBF on by default, anti-fee-sniping locktime, randomized output order;
   - BIP32 derivations and global xpub, so the signer proves the change is yours.
3. **Send to the signer:**
   - animated QR (BBQr for Coldcard Q, UR `crypto-psbt` for Keystone/Passport/Jade/SeedSigner);
   - a `.psbt` file (Coldcard Mk4 SD card);
   - copy as base64.
4. **Bring it back:** scan the signed QR or load the file, then finalize. A final check confirms the signed transaction equals the planned one (same inputs, outputs, fee), with a privacy re-analysis. Then broadcast.
5. **Receive:** next unused address as a QR, a "verify on your device" step, a label for whom it was given to, and gap tracking.

Testing: the tester's Coldcard on signet, plus signer emulators where they exist.

## Phase 2: transaction lifecycle

- Pending transactions view.
- Fee bump with RBF, CPFP, and cancel (RBF to self).
- PSBT drafts saved with the wallet (under the cache setting).

## Phase 3: multisig

- `wsh(sortedmulti)` and `tr` multisig descriptors.
- Import of cosigner xpubs.
- A coordinator flow: PSBT combine across signers, and progress per cosigner.
- Multisig-aware privacy analysis and coin selection.

## Phase 4: optional

- Sending PayJoin (BIP77/78). This means sending only; detecting PayJoin stays out by design.
- Silent payments (sending).
- Message signing and verification through the signer.

## Security model

A website that builds transactions is a target: a tampered build could swap the destination or change address.

- **Watch-only forever:** private keys and seeds are never entered or stored.
- **Signer as the source of truth:** the user verifies outputs on the signer screen. The change is proven by derivation data, so the signer shows it as change.
- **Self-hosting recommended for spending:** the Umbrel and StartOS packages serve the app from your own node.
- **Release integrity:** reproducible builds, signed releases, and published hashes for the static build.
- **The privacy analysis runs on the final signed transaction,** not just the plan.

## Open questions for testers

- Which signers matter most first (Coldcard Q/Mk4, Keystone, Passport, Jade, SeedSigner)?
- Is the phase order right: spend before fee bumping, multisig later?
- Is a web coordinator acceptable for spending if self-hosted, or is a desktop build needed?
