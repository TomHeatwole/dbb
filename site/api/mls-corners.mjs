import { fetchCornerBook, MLS_BOOK_CONFIG } from './pl-corners.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = await fetchCornerBook(MLS_BOOK_CONFIG);
    res.setHeader('Cache-Control', 'public, max-age=15');
    return res.status(200).json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[mls-corners]', err);
    return res.status(502).json({ error: err.message || 'MLS corners fetch failed' });
  }
}
