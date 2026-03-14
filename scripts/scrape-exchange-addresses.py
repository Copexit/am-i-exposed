#!/usr/bin/env python3
"""
Scrape Bitcoin addresses for exchanges with thin coverage from:
1. Arkham Intelligence
2. CoinCarp
3. BitInfoCharts

Outputs to .cache/entity-data/curated/exchange-arkham-coincarp-deep.csv
"""

import re
import time
import sys
import os
from datetime import datetime

# Change to project root
os.chdir("/home/user/am-i-exposed")

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

# Bitcoin address regex
BTC_ADDR_RE = re.compile(r'\b(bc1[a-zA-HJ-NP-Z0-9]{25,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b')
LEGACY_RE = re.compile(r'^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$')
BECH32_RE = re.compile(r'^bc1[a-zA-HJ-NP-Z0-9]{25,90}$')

OUTPUT_CSV = "/home/user/am-i-exposed/.cache/entity-data/curated/exchange-arkham-coincarp-deep.csv"
CURATED_DIR = "/home/user/am-i-exposed/.cache/entity-data/curated"

def is_valid_btc(addr):
    """Validate Bitcoin address format."""
    if addr.startswith("bc1"):
        return len(addr) >= 42 and len(addr) <= 90 and bool(BECH32_RE.match(addr))
    elif addr.startswith("1") or addr.startswith("3"):
        return len(addr) >= 26 and len(addr) <= 35 and bool(LEGACY_RE.match(addr))
    return False

def load_dedup_set():
    """Load all addresses from existing curated CSVs for dedup."""
    dedup = set()
    for fname in os.listdir(CURATED_DIR):
        if not fname.endswith(".csv"):
            continue
        # Skip our own output file to allow re-runs
        if fname == "exchange-arkham-coincarp-deep.csv":
            continue
        fpath = os.path.join(CURATED_DIR, fname)
        with open(fpath, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or line.startswith("address,"):
                    continue
                addr = line.split(",")[0]
                if addr and is_valid_btc(addr):
                    dedup.add(addr)
    return dedup


# Results collector
results = []  # list of (address, entity_name, source)
dedup_set = load_dedup_set()
print(f"Loaded {len(dedup_set)} existing addresses for dedup")


def add_results(addresses, entity_name, source):
    """Add new addresses that pass dedup. Returns count of new addresses."""
    new_count = 0
    for addr in sorted(addresses):
        if addr not in dedup_set:
            results.append((addr, entity_name, source))
            dedup_set.add(addr)  # prevent cross-source dupes within this run
            new_count += 1
    return new_count


def extract_btc_addresses(content):
    """Extract valid BTC addresses from page content."""
    raw = set(BTC_ADDR_RE.findall(content))
    return {a for a in raw if is_valid_btc(a)}


def scrape_arkham(page):
    """Scrape Arkham Intelligence entity pages."""
    print("\n" + "=" * 60)
    print("PHASE 1: ARKHAM INTELLIGENCE")
    print("=" * 60)

    targets = [
        ("ftx", "FTX"),
        ("celsius", "Celsius"),
        ("voyager-digital", "Voyager"),
        ("binance-us", "Binance US"),
        ("upbit", "Upbit"),
        ("bithumb", "Bithumb"),
        ("kucoin", "KuCoin"),
        ("crypto-com", "Crypto.com"),
        ("bitget", "Bitget"),
        ("mexc", "MEXC"),
        ("gate-io", "Gate.io"),
        ("nexo", "Nexo"),
        ("changenow", "ChangeNOW"),
        ("shapeshift", "ShapeShift"),
        ("fixedfloat", "FixedFloat"),
        ("sideshift", "SideShift"),
        ("bitstamp", "Bitstamp"),
        ("bitfinex", "Bitfinex"),
        ("bitpanda", "Bitpanda"),
        ("huobi", "Huobi (HTX)"),
        ("blockchain-com", "Blockchain.com"),
        ("cash-app", "Cash App"),
        ("galaxy-digital", "Galaxy Digital"),
        ("paxos", "Paxos"),
        ("wazirx", "WazirX"),
        ("garantex", "Garantex"),
        ("coinex", "CoinEx"),
        ("lbank", "LBank"),
        ("bitmart", "BitMart"),
        ("hitbtc", "HitBTC"),
        ("whitebit", "WhiteBIT"),
        ("probit", "ProBit"),
    ]

    auth_walled = False
    for slug, entity_name in targets:
        if auth_walled:
            print(f"  [Arkham] {entity_name}: SKIPPED (auth wall detected)")
            continue

        url = f"https://platform.arkhamintelligence.com/explorer/entity/{slug}"
        try:
            print(f"  [Arkham] {entity_name} ({slug})...", end=" ", flush=True)
            resp = page.goto(url, timeout=30000)

            if resp and resp.status >= 400:
                print(f"HTTP {resp.status}")
                time.sleep(1)
                continue

            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except PlaywrightTimeout:
                pass
            time.sleep(2)

            content = page.content()

            # Check for auth wall
            lower_content = content.lower()
            if ('sign in' in lower_content and 'login' in lower_content) or 'create an account' in lower_content:
                print("AUTH WALL - skipping all Arkham")
                auth_walled = True
                continue

            # Try clicking on Bitcoin/BTC tab/filter if available
            for selector in ["text=Bitcoin", "text=BTC", "[data-chain='bitcoin']"]:
                try:
                    btn = page.locator(selector).first
                    if btn.is_visible(timeout=1500):
                        btn.click()
                        time.sleep(1)
                        break
                except:
                    pass

            # Scroll to load more
            for _ in range(3):
                try:
                    page.keyboard.press("End")
                    time.sleep(0.5)
                except:
                    pass

            # Check Funding tab
            for tab_text in ["Funding", "Portfolio"]:
                try:
                    tab = page.locator(f"text={tab_text}").first
                    if tab.is_visible(timeout=1500):
                        tab.click()
                        time.sleep(2)
                except:
                    pass

            content = page.content()
            addresses = extract_btc_addresses(content)
            new_count = add_results(addresses, entity_name, "arkham-labeled")
            print(f"found {len(addresses)} total, {new_count} new")

        except Exception as e:
            print(f"ERROR: {e}")

        time.sleep(3)  # Rate limit


def scrape_coincarp(page):
    """Scrape CoinCarp exchange wallet pages."""
    print("\n" + "=" * 60)
    print("PHASE 2: COINCARP")
    print("=" * 60)

    targets = [
        ("ftx", "FTX"),
        ("celsius", "Celsius"),
        ("binance-us", "Binance US"),
        ("upbit", "Upbit"),
        ("bithumb", "Bithumb"),
        ("kucoin", "KuCoin"),
        ("crypto-com", "Crypto.com"),
        ("bitget", "Bitget"),
        ("mexc", "MEXC"),
        ("gate-io", "Gate.io"),
        ("gateio", "Gate.io"),
        ("nexo", "Nexo"),
        ("changenow", "ChangeNOW"),
        ("shapeshift", "ShapeShift"),
        ("bitstamp", "Bitstamp"),
        ("bitfinex", "Bitfinex"),
        ("blockchain-com", "Blockchain.com"),
        ("wazirx", "WazirX"),
        ("garantex", "Garantex"),
        ("lbank", "LBank"),
        ("bitmart", "BitMart"),
        ("hitbtc", "HitBTC"),
        ("whitebit", "WhiteBIT"),
        ("probit", "ProBit"),
        ("bitpanda", "Bitpanda"),
        ("bitkub", "Bitkub"),
        ("btcturk", "BtcTurk"),
        ("indodax", "Indodax"),
        ("luno", "Luno"),
        ("coinone", "Coinone"),
        ("fixedfloat", "FixedFloat"),
        ("sideshift", "SideShift"),
        ("cash-app", "Cash App"),
        ("paxos", "Paxos"),
        ("galaxy-digital", "Galaxy Digital"),
        ("coinex", "CoinEx"),
        ("voyager", "Voyager"),
    ]

    for slug, entity_name in targets:
        url = f"https://www.coincarp.com/exchange/{slug}/wallets/"
        try:
            print(f"  [CoinCarp] {entity_name} ({slug})...", end=" ", flush=True)
            resp = page.goto(url, timeout=30000)

            if resp and resp.status >= 400:
                print(f"HTTP {resp.status}")
                time.sleep(1)
                continue

            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except PlaywrightTimeout:
                pass
            time.sleep(2)

            # Try clicking BTC/Bitcoin filter
            for selector in ["text=BTC", "text=Bitcoin", "[data-chain='btc']", "button:has-text('BTC')"]:
                try:
                    btn = page.locator(selector).first
                    if btn.is_visible(timeout=1500):
                        btn.click()
                        time.sleep(1)
                        break
                except:
                    pass

            # Scroll to load more
            for _ in range(5):
                try:
                    page.keyboard.press("End")
                    time.sleep(0.5)
                except:
                    pass

            # Click "Show More"/"Load More" if present
            for btn_text in ["Show More", "Load More", "View All", "show more", "load more"]:
                try:
                    more_btn = page.locator(f"text={btn_text}").first
                    if more_btn.is_visible(timeout=1000):
                        more_btn.click()
                        time.sleep(2)
                except:
                    pass

            content = page.content()
            addresses = extract_btc_addresses(content)
            new_count = add_results(addresses, entity_name, "coincarp-labeled")
            print(f"found {len(addresses)} total, {new_count} new")

        except Exception as e:
            print(f"ERROR: {e}")

        time.sleep(2)  # Rate limit


def scrape_bitinfocharts(page):
    """Scrape BitInfoCharts wallet pages."""
    print("\n" + "=" * 60)
    print("PHASE 3: BITINFOCHARTS")
    print("=" * 60)

    targets = [
        ("Garantex", "Garantex"),
        ("FTX", "FTX"),
        ("FTX.com", "FTX"),
        ("Bitget", "Bitget"),
        ("MEXC", "MEXC"),
        ("ChangeNOW", "ChangeNOW"),
        ("Changenow", "ChangeNOW"),
        ("Nexo", "Nexo"),
        ("Voyager", "Voyager"),
        ("WazirX", "WazirX"),
        ("BitMart", "BitMart"),
        ("WhiteBIT", "WhiteBIT"),
        ("Whitebit", "WhiteBIT"),
        ("LBank", "LBank"),
        ("CoinEx", "CoinEx"),
        ("Coinex", "CoinEx"),
        ("Bitpanda", "Bitpanda"),
        ("Bitkub", "Bitkub"),
        ("BtcTurk", "BtcTurk"),
        ("Binance.us", "Binance US"),
        ("Celsius", "Celsius"),
        ("Upbit", "Upbit"),
        ("Bithumb", "Bithumb"),
        ("KuCoin", "KuCoin"),
        ("Crypto.com", "Crypto.com"),
        ("Gate.io", "Gate.io"),
        ("FixedFloat", "FixedFloat"),
        ("SideShift", "SideShift"),
        ("Cash+App", "Cash App"),
        ("Galaxy+Digital", "Galaxy Digital"),
        ("Paxos", "Paxos"),
        ("ProBit", "ProBit"),
        ("Coinone", "Coinone"),
        ("Indodax", "Indodax"),
        ("Luno", "Luno"),
        ("Blockchain.com", "Blockchain.com"),
        ("ShapeShift", "ShapeShift"),
        ("HitBTC", "HitBTC"),
    ]

    for name, entity_name in targets:
        url = f"https://bitinfocharts.com/bitcoin/wallet/{name}"
        try:
            print(f"  [BitInfoCharts] {entity_name} ({name})...", end=" ", flush=True)
            resp = page.goto(url, timeout=30000)

            if resp and resp.status >= 400:
                print(f"HTTP {resp.status}")
                time.sleep(1)
                continue

            # Wait for table
            try:
                page.wait_for_selector('table', timeout=10000)
            except:
                pass
            time.sleep(1)

            # Scroll
            for _ in range(3):
                try:
                    page.keyboard.press("End")
                    time.sleep(0.5)
                except:
                    pass

            # Try following pagination ("Next" links) for up to 3 pages
            all_content = page.content()
            for _ in range(3):
                try:
                    next_link = page.locator("a:has-text('Next')").first
                    if next_link.is_visible(timeout=1500):
                        next_link.click()
                        time.sleep(2)
                        all_content += page.content()
                    else:
                        break
                except:
                    break

            addresses = extract_btc_addresses(all_content)
            new_count = add_results(addresses, entity_name, "bitinfocharts-labeled")
            print(f"found {len(addresses)} total, {new_count} new")

        except Exception as e:
            print(f"ERROR: {e}")

        time.sleep(2)  # Rate limit


def write_output():
    """Write results to CSV, grouped by entity."""
    by_entity = {}
    for addr, entity, source in results:
        if entity not in by_entity:
            by_entity[entity] = []
        by_entity[entity].append((addr, source))

    with open(OUTPUT_CSV, "w") as f:
        f.write(f"# Exchange addresses scraped from Arkham Intelligence, CoinCarp, and BitInfoCharts\n")
        f.write(f"# Generated: {datetime.now().strftime('%Y-%m-%d')}\n")
        f.write(f"# Total: {len(results)} addresses across {len(by_entity)} entities\n")
        f.write("address,entity,source\n")

        for entity_name in sorted(by_entity.keys()):
            entries = sorted(by_entity[entity_name], key=lambda x: x[0])
            f.write(f"# {entity_name} ({len(entries)} addresses)\n")
            for addr, source in entries:
                f.write(f"{addr},{entity_name},{source}\n")

    print(f"\nWrote {len(results)} addresses to {OUTPUT_CSV}")
    if by_entity:
        print(f"Entities with results:")
        for entity_name in sorted(by_entity.keys()):
            print(f"  {entity_name}: {len(by_entity[entity_name])}")
    else:
        print("No new addresses found from any source.")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            channel="chrome",
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
        )
        context = browser.new_context(
            user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
            viewport={"width": 1920, "height": 1080},
        )
        context.set_extra_http_headers({
            "Accept-Language": "en-US,en;q=0.9",
        })
        # Block heavy resources for speed
        context.route("**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,ttf,eot}", lambda route: route.abort())

        page = context.new_page()

        # Run all three scrapers
        scrape_arkham(page)
        scrape_coincarp(page)
        scrape_bitinfocharts(page)

        browser.close()

    # Write output
    write_output()

    # Summary
    print("\n" + "=" * 60)
    print("SCRAPING COMPLETE")
    print("=" * 60)
    print(f"Total new addresses: {len(results)}")


if __name__ == "__main__":
    main()
