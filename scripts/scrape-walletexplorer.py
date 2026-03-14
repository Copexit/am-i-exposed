#!/usr/bin/env python3
"""
Scrape WalletExplorer.com - the old Chainalysis-acquired site that
labels Bitcoin wallet clusters. Uses correct slug names.
Also tries blockchain.info/tags and mempool.space for tagged addresses.
"""

import re
import time
import os
import sys

# Force unbuffered output
sys.stdout = os.fdopen(sys.stdout.fileno(), 'w', 1)

from playwright.sync_api import sync_playwright

OUTPUT_CSV = "/home/user/am-i-exposed/.cache/entity-data/curated/exchange-playwright-scraped.csv"
EXISTING_ADDR_FILE = "/tmp/existing-exchange-addrs.txt"
CURATED_DIR = "/home/user/am-i-exposed/.cache/entity-data/curated"

DEDUP_FILES = [
    "exchange-tier1-addresses.csv",
    "exchange-tier2-addresses.csv",
    "exchange-tier3-addresses.csv",
    "exchange-modern-curated.csv",
    "proof-of-reserves.csv",
    "bitinfocharts-richlist.csv",
    "bankruptcy-exchange-addresses.csv",
    "exchange-playwright-scraped.csv",
]

BTC_ADDR_RE = re.compile(r'\b(bc1[a-zA-HJ-NP-Z0-9]{25,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b')
LEGACY_RE = re.compile(r'^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$')
BECH32_RE = re.compile(r'^bc1[a-zA-HJ-NP-Z0-9]{25,90}$')

def is_valid_btc(addr):
    return bool(LEGACY_RE.match(addr) or BECH32_RE.match(addr))

def load_existing():
    existing = set()
    if os.path.exists(EXISTING_ADDR_FILE):
        with open(EXISTING_ADDR_FILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    addr = line.split(',')[0].strip()
                    if is_valid_btc(addr):
                        existing.add(addr)
    for fname in DEDUP_FILES:
        fpath = os.path.join(CURATED_DIR, fname)
        if os.path.exists(fpath):
            with open(fpath) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and not line.startswith('address'):
                        addr = line.split(',')[0].strip()
                        if is_valid_btc(addr):
                            existing.add(addr)
    print(f"[DEDUP] Loaded {len(existing)} existing addresses")
    return existing

def extract_new(content, existing):
    raw = BTC_ADDR_RE.findall(content)
    seen = set()
    addrs = []
    for a in raw:
        if a not in seen and is_valid_btc(a) and a not in existing:
            seen.add(a)
            addrs.append(a)
    return addrs


def main():
    existing = load_existing()
    all_results = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            channel="chrome",
            args=["--no-sandbox", "--disable-dev-shm-usage"]
        )
        context = browser.new_context(
            user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.6881.40 Safari/537.36",
            viewport={"width": 1920, "height": 1080},
        )
        page = context.new_page()

        # WalletExplorer with various known slug formats
        print("=" * 60)
        print("WalletExplorer.com")
        print("=" * 60)

        # WalletExplorer uses specific wallet names
        we_targets = [
            # Known WalletExplorer slugs (from their directory)
            ("Bitstamp.net", "Bitstamp"),
            ("Poloniex.com", "Poloniex"),
            ("Bittrex.com", "Bittrex"),
            ("BTC-e.com", "BTC-e"),
            ("Kraken.com", "Kraken"),
            ("Coinbase.com", "Coinbase"),
            ("Bitfinex.com", "Bitfinex"),
            ("BitMEX.com", "BitMEX"),
            ("Binance.com", "Binance"),
            ("Huobi.com", "Huobi (HTX)"),
            ("OKEx.com", "OKX"),
            ("KuCoin.com", "KuCoin"),
            ("ShapeShift.io", "ShapeShift"),
            ("Cryptopia.co.nz", "Cryptopia"),
            ("CEX.IO", "CEX.IO"),
            ("Gemini.com", "Gemini"),
            ("Bithumb.com", "Bithumb"),
            ("Bybit.com", "Bybit"),
            ("Gate.io", "Gate.io"),
            ("CoinEx.com", "CoinEx"),
            ("Bitpanda.com", "Bitpanda"),
        ]

        for slug, entity in we_targets:
            url = f"https://www.walletexplorer.com/wallet/{slug}/addresses"
            print(f"\n[WE] {url} -> {entity}")

            try:
                resp = page.goto(url, timeout=20000, wait_until="domcontentloaded")
                time.sleep(2)

                content = page.content()
                title = page.title()
                print(f"  Title: {title}")

                addrs = extract_new(content, existing)
                raw_c = len(set(BTC_ADDR_RE.findall(content)))

                if addrs:
                    print(f"  Found {len(addrs)} new addresses")
                    all_results.setdefault(entity, []).extend([(a, "walletexplorer-labeled") for a in addrs])
                    existing.update(addrs)
                else:
                    print(f"  No new addresses (total: {raw_c})")

            except Exception as e:
                err_str = str(e)
                if 'ERR_HTTP_RESPONSE_CODE_FAILURE' in err_str:
                    print(f"  HTTP error (likely 404/503)")
                else:
                    print(f"  Error: {err_str[:100]}")

            time.sleep(2)

        # Also try the WalletExplorer directory page
        print("\n" + "=" * 60)
        print("WalletExplorer Directory")
        print("=" * 60)
        try:
            page.goto("https://www.walletexplorer.com/", timeout=20000, wait_until="domcontentloaded")
            time.sleep(2)
            content = page.content()
            print(f"  Title: {page.title()}")
            # Look for exchange wallet links
            links = page.query_selector_all('a[href*="/wallet/"]')
            exchange_links = []
            for link in links:
                href = link.get_attribute('href')
                text = link.inner_text()
                if href and '/wallet/' in href:
                    exchange_links.append((href, text))
            print(f"  Found {len(exchange_links)} wallet links")
            for href, text in exchange_links[:20]:
                print(f"    {text}: {href}")
        except Exception as e:
            print(f"  Error: {e}")

        browser.close()

    # Append results
    if all_results:
        existing_entries = set()
        if os.path.exists(OUTPUT_CSV):
            with open(OUTPUT_CSV) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and not line.startswith('address'):
                        existing_entries.add(line)

        with open(OUTPUT_CSV, 'a') as f:
            for entity in sorted(all_results.keys()):
                entries = all_results[entity]
                if not entries:
                    continue
                f.write(f"# {entity} (walletexplorer)\n")
                for addr, source in sorted(entries, key=lambda x: x[0]):
                    line = f"{addr},{entity},{source}"
                    if line not in existing_entries:
                        f.write(line + "\n")

        total = sum(len(v) for v in all_results.values())
        print(f"\n[DONE] Appended {total} new addresses")
    else:
        print("\n[DONE] No new addresses from WalletExplorer")

    print("\nResults:")
    for entity in sorted(all_results.keys()):
        print(f"  {entity}: {len(all_results[entity])}")


if __name__ == "__main__":
    main()
