import { existsSync, statSync } from 'fs';
import { join } from 'path';

export default function handler(req, res) {
  const cwd = process.cwd();
  const files = [
    'players.txt',
    'ktc_values.csv',
    'fantasycalc.csv',
    'ffb.csv',
    'score_format.json',
  ];

  const results = files.map((f) => {
    const path = join(cwd, 'public', 'data', f);
    const exists = existsSync(path);
    return {
      file: f,
      path,
      exists,
      sizeBytes: exists ? statSync(path).size : null,
    };
  });

  res.status(200).json({ cwd, files: results });
}
