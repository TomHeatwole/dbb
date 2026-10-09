export const RAW_BOOKS = [
  { id: 'fd', label: 'FanDuel', short: 'FD' },
  { id: 'dk', label: 'DraftKings', short: 'DK' },
  { id: 'mgm', label: 'BetMGM', short: 'MGM' },
  { id: 'czr', label: 'Caesars', short: 'CZR' },
];

export const RAW_BOOK_IDS = RAW_BOOKS.map((book) => book.id);

export function bookShort(id) {
  return RAW_BOOKS.find((book) => book.id === id)?.short || String(id || '').toUpperCase();
}

export function isRawBookId(id) {
  return RAW_BOOK_IDS.includes(id);
}
