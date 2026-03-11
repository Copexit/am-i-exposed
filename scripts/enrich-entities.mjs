#!/usr/bin/env node
/**
 * Enrich entities.json with data from bithypha_entities_enriched.json
 * and add missing entities from the entity INDEX.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Config ---

const entitiesPath = resolve(__dirname, '../src/data/entities.json');
const bithyphaPath = resolve('/home/user/feedback5/bithypha_entities_enriched.json');

// Category mapping from bithypha to our format
const categoryMap = {
  'Exchange': 'exchange',
  'Mining Pool': 'mining',
  'Gambling': 'gambling',
  'Mixer': 'mixer',
  'Darknet Market': 'darknet',
  'Scam/Fraud': 'scam',
  'P2P': 'p2p',
  'Payment Processor': 'payment',
  'Ransomware/Malware': 'scam',
  'Lending/Finance': 'exchange',
  'Government/Notable': 'payment',
  'Other': 'payment',
};

// Country code to country name mapping
const countryCodeMap = {
  'US': 'US',
  'CN': 'China',
  'VG': 'BVI',
  'SC': 'Seychelles',
  'LU': 'Luxembourg',
  'PH': 'Philippines',
  'CA': 'Canada',
  'MT': 'Malta',
  'RU': 'Russia',
  'BR': 'Brazil',
  'HK': 'Hong Kong',
  'GB': 'UK',
  'GI': 'Gibraltar',
  '\u2014': 'Unknown',  // em dash used in bithypha data as "unknown"
};

// Entities from the INDEX binary (129 names)
const indexEntities = [
  'Bittrex', 'AnxPro', 'Luno', 'BitBay', 'Poloniex', 'Mercado Bitcoin',
  'Bitstamp', 'Huobi (HTX)', 'Bitcoin.de', 'CoinSpot', 'BitBargain.co.uk',
  'BTC-e', 'Bleutrade', 'Matbea', 'SpectroCoin', 'LocalBitcoins', 'Coinmate',
  'CoinHako', 'BTCC', 'CoinMotion', 'Paxful', 'CEX.IO', 'BX', 'FYBSG',
  'Vaultoro', 'Hashnest', 'HitBtc', 'OKCoin', 'Bit-x', 'YoBit',
  'TheRockTrading', 'Kraken', 'BitKonan', 'Bter', 'VirWoX', 'HappyCoins',
  'ChBtc', 'BlockTrades.us', 'BtcTrade', 'LakeBTC', 'CoinCafe', 'MaiCoin',
  'Gatecoin', 'Coingi', 'SimpleCoin.cz', 'Exmo', 'CoinTrader', 'Coinbroker',
  'Vircurex', 'Indacoin', '1Coin', 'Igot', 'Cryptsy', 'CleverCoin', 'FoxBit',
  'EmpoEX', 'LiteBit', 'UseCryptos', 'MeXBT', 'Banx', 'Coinomat', 'Bitfinex',
  'Zyado', 'Coinimal', 'ExchangeMyCoins', 'OrderBook', '796', 'QuadrigaCX',
  'Bitso', 'Btc38', 'Ccedk', 'CoinChimp', 'CoinArch', 'Cavirtex', 'Coins-e',
  'BTC Markets', 'Korbit.co.kr', 'Cryptonit', 'Exchanging.ir', 'Bitcurex',
  'BTradeAustralia', 'BitVC', 'C-Cex', 'Exchange-Credit.ru', 'CampBX',
  'BitcoinVietnam.com.vn',
  // Mining pools
  'Kano.is', 'SlushPool', 'Telco214', 'Antpool', 'Eligius', 'EclipseMC',
  'GHash', 'BW', 'Bitfury', 'KnCMiner', 'BitMinter', 'BTCCPool',
  // Gambling
  'CoinGaming', 'Cloudbet', 'BitStarz', 'BitZino', 'AnoniBet', 'Betcoin.tm',
  'Coinroll', 'PocketDice', 'Peerbet', 'BitZillions', '777Coin', 'JetWin',
  'SwCPoker', 'FairProof', 'MineField.BitcoinLab', 'Nitrogen Sports',
  'Satoshi-Karoshi', 'BetMoose', 'LuckyB.it', 'SecondsTrade', 'Coinichiwa',
  'BTCOracle', 'CoinRoyale', 'SafeDice', 'SatoshiRoulette', 'SatoshiMines',
  'Satoshi Dice', 'BitcoinVideoCasino', '999Dice', 'YABTCL', 'FortuneJack',
];

const indexMiningPools = new Set([
  'SlushPool', 'Kano.is', 'Telco214', 'Antpool', 'Eligius', 'EclipseMC',
  'GHash', 'BW', 'Bitfury', 'KnCMiner', 'BitMinter', 'BTCCPool',
]);

const indexGambling = new Set([
  'CoinGaming', 'Cloudbet', 'BitStarz', 'BitZino', 'AnoniBet', 'Betcoin.tm',
  'Coinroll', 'PocketDice', 'Peerbet', 'BitZillions', '777Coin', 'JetWin',
  'SwCPoker', 'FairProof', 'MineField.BitcoinLab', 'Nitrogen Sports',
  'Satoshi-Karoshi', 'BetMoose', 'LuckyB.it', 'SecondsTrade', 'Coinichiwa',
  'BTCOracle', 'CoinRoyale', 'SafeDice', 'SatoshiRoulette', 'SatoshiMines',
  'Satoshi Dice', 'BitcoinVideoCasino', '999Dice', 'YABTCL', 'FortuneJack',
]);

// Name normalization for matching across sources
// Maps lowercase variant -> canonical name in entities.json
function buildNameMap(entities) {
  const map = new Map();
  for (const e of entities) {
    map.set(e.name.toLowerCase(), e);
  }
  return map;
}

// Bithypha name aliases (bithypha lowercase name -> entities.json name)
const bithyphaAliases = {
  'htx': 'Huobi (HTX)',
  'cloudbet.com': 'Cloudbet',
  'bleutrade': 'Bleutrade',
  'celsius network': 'Celsius',
  'coinhako': 'CoinHako',
  'coinmotion': 'CoinMotion',
  'matbea': 'Matbea',
  'foundry': 'Foundry USA',
  'river': 'River Financial',
  'bitconnect': 'BitConnect',
  'noones': 'Noones',
  'evolution market': 'Evolution',
  'cavirtex': 'Cavirtex',
  'satoshimines.com': 'SatoshiMines',
  'pocketdice.io': 'PocketDice',
  'luckyb.it': 'LuckyB.it',
  'c-cex.com': 'C-Cex',
  'bx.in.th': 'BX',
  'luxor technology': 'Luxor',
  'btctrade.com': 'BtcTrade',
  'braiins': 'Braiins Pool',
  'antpool': 'Antpool',
  'gourl': 'GoURL',
  'bitflyer': 'BitFlyer',
  'hydra market': 'Hydra',
};

// Index name aliases (index name -> entities.json name)
const indexAliases = {
  'korbit.co.kr': 'Korbit',
  'cavirtex': 'CaVirtEx',
};

function mapCountry(code) {
  if (!code || code === '\u2014') return 'Unknown';
  return countryCodeMap[code] || code;
}

function mapStatus(status) {
  if (!status || status === 'unknown') return 'active';
  return status === 'closed' ? 'closed' : 'active';
}

function mapCategory(cat) {
  return categoryMap[cat] || 'payment';
}

// --- Main ---

const entitiesData = JSON.parse(readFileSync(entitiesPath, 'utf8'));
const bithyphaData = JSON.parse(readFileSync(bithyphaPath, 'utf8'));

const entities = entitiesData.entities;
const nameMap = buildNameMap(entities);

let updatedCount = 0;
let addedFromBithypha = 0;
let addedFromIndex = 0;

// Skip these bithypha entries (not real entities for our purposes)
const skipNames = new Set([
  'block reward', 'merged cluster', 'unknown whale', 'james howells',
  'el salvador government', 'chivo wallet', 'u.s. government',
  'satoshi nakamoto', 'bitcoin faucet', 'abusive material',
]);

// Step 1: Process bithypha entities
for (const bh of bithyphaData) {
  const bhNameLower = bh.name.toLowerCase();

  // Skip non-entity entries
  if (skipNames.has(bhNameLower)) continue;

  // Check alias first
  const aliasTarget = bithyphaAliases[bhNameLower];
  const existing = aliasTarget
    ? nameMap.get(aliasTarget.toLowerCase())
    : nameMap.get(bhNameLower);

  if (existing) {
    // Update missing fields
    let changed = false;
    const bhCountry = mapCountry(bh.country);
    if ((existing.country === 'Unknown' || !existing.country) && bhCountry !== 'Unknown') {
      existing.country = bhCountry;
      changed = true;
    }
    // Note: OFAC flags are now managed exclusively by update-ofac.mjs
    if (changed) updatedCount++;
  } else {
    // New entity from bithypha
    const newEntity = {
      name: bh.name,
      category: mapCategory(bh.category),
      status: mapStatus(bh.status),
      country: mapCountry(bh.country),
      ofac: false,  // OFAC flags managed exclusively by update-ofac.mjs
    };
    entities.push(newEntity);
    nameMap.set(bhNameLower, newEntity);
    addedFromBithypha++;
  }
}

// Step 2: Process INDEX entities
for (const name of indexEntities) {
  const nameLower = name.toLowerCase();
  const aliasTarget = indexAliases[nameLower];
  const existing = aliasTarget
    ? nameMap.get(aliasTarget.toLowerCase())
    : nameMap.get(nameLower);

  if (existing) continue; // Already present

  let category = 'exchange';
  if (indexMiningPools.has(name)) category = 'mining';
  if (indexGambling.has(name)) category = 'gambling';

  const newEntity = {
    name,
    category,
    status: 'closed',  // Most index-only entities are historical/closed
    country: 'Unknown',
    ofac: false,
  };
  entities.push(newEntity);
  nameMap.set(nameLower, newEntity);
  addedFromIndex++;
}

// Update timestamp
entitiesData.lastUpdated = '2026-03-08';

// Write result
const output = JSON.stringify(entitiesData, null, 2) + '\n';
writeFileSync(entitiesPath, output, 'utf8');

console.log(`Done!`);
console.log(`  Original entities: 158`);
console.log(`  Updated from bithypha: ${updatedCount}`);
console.log(`  Added from bithypha: ${addedFromBithypha}`);
console.log(`  Added from INDEX: ${addedFromIndex}`);
console.log(`  Final total: ${entities.length}`);
