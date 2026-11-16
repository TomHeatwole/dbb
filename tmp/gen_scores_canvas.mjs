import { readFileSync, writeFileSync } from 'fs';

const payload = JSON.parse(readFileSync('/Users/tomh/dev/dbb/tmp/scores_viz_payload.json', 'utf8'));
const scores = payload.compact.map((c) => ({ p: c.p, s: c.s, w: c.w }));
const lo = Math.floor(payload.stats.min / 10) * 10;
const hi = Math.ceil(payload.stats.max / 10) * 10;
const histLabels = [];
const histCounts = [];
for (let b = lo; b < hi; b += 10) {
  histLabels.push(`${b}+`);
  histCounts.push(0);
}
for (const c of scores) {
  const i = Math.min(histCounts.length - 1, Math.floor((c.p - lo) / 10));
  histCounts[i]++;
}
const top = payload.top.slice(0, 20).map((t) => ({
  pts: t.pts,
  team: t.team,
  season: t.season,
  week: t.week,
}));

const out = '/Users/tomh/.cursor/projects/Users-tomh-dev-dbb/canvases/hwang-weekly-scores-all-time.canvas.tsx';

const body = `import {
  BarChart,
  Card,
  CardBody,
  CardHeader,
  Grid,
  H1,
  H2,
  LineChart,
  Row,
  Stack,
  Stat,
  Table,
  Text,
  Pill,
  useCanvasState,
  useHostTheme,
  useMemo,
} from 'cursor/canvas';

const STATS = ${JSON.stringify(payload.stats)} as const;
const SCORES = ${JSON.stringify(scores)} as Array<{ p: number; s: number; w: number }>;
const WEEKLY = ${JSON.stringify(payload.weeklyAvgBySeason)} as Record<
  string,
  Array<{ week: number; avg: number | null; min: number | null; max: number | null }>
>;
const TOP = ${JSON.stringify(top)} as Array<{ pts: number; team: string; season: number; week: number }>;
const HIST = ${JSON.stringify({ labels: histLabels, counts: histCounts })} as {
  labels: string[];
  counts: number[];
};

const WEEK_CATS = Array.from({ length: 17 }, (_, i) => String(i + 1));

type SeasonFilter = 'all' | '2024' | '2025' | '2026';

function seasonX(season: number, week: number) {
  return (season - 2024) * 17 + week;
}

function ScoreScatter({ filter }: { filter: SeasonFilter }) {
  const theme = useHostTheme();
  const points = useMemo(
    () => (filter === 'all' ? SCORES : SCORES.filter((d) => String(d.s) === filter)),
    [filter],
  );
  const w = 720;
  const h = 280;
  const pad = { t: 12, r: 16, b: 36, l: 44 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const yMin = 30;
  const yMax = 245;
  const xMin = 0.5;
  const xMax = 51.5;
  const sx = (x: number) => pad.l + ((x - xMin) / (xMax - xMin)) * innerW;
  const sy = (y: number) => pad.t + innerH - ((y - yMin) / (yMax - yMin)) * innerH;
  const seasonFill: Record<number, string> = {
    2024: theme.category.blue,
    2025: theme.category.gray,
    2026: theme.category.green,
  };

  return (
    <div>
      <svg width="100%" viewBox={'0 0 ' + w + ' ' + h} style={{ display: 'block', maxWidth: w }}>
        {[100, 150, 200].map((y) => (
          <g key={y}>
            <line
              x1={pad.l}
              y1={sy(y)}
              x2={w - pad.r}
              y2={sy(y)}
              stroke={theme.stroke.tertiary}
              strokeWidth={1}
            />
            <text x={pad.l - 6} y={sy(y) + 4} textAnchor="end" fontSize={10} fill={theme.text.tertiary}>
              {y}
            </text>
          </g>
        ))}
        {[1, 18, 35].map((x, i) => (
          <text key={x} x={sx(x + 8)} y={h - 10} textAnchor="middle" fontSize={10} fill={theme.text.secondary}>
            {2024 + i}
          </text>
        ))}
        {points.map((d, i) => (
          <circle
            key={d.s + '-' + d.w + '-' + i}
            cx={sx(seasonX(d.s, d.w))}
            cy={sy(d.p)}
            r={d.p >= 190 ? 4 : 2.5}
            fill={seasonFill[d.s] ?? theme.fill.secondary}
            opacity={d.p >= 190 ? 0.95 : 0.55}
          />
        ))}
        <line
          x1={pad.l}
          y1={sy(STATS.mean)}
          x2={w - pad.r}
          y2={sy(STATS.mean)}
          stroke={theme.accent.primary}
          strokeWidth={1}
          strokeDasharray="4 3"
        />
        <text x={w - pad.r} y={sy(STATS.mean) - 4} textAnchor="end" fontSize={10} fill={theme.accent.primary}>
          {'mean ' + STATS.mean}
        </text>
        <text x={pad.l} y={pad.t + 10} fontSize={11} fill={theme.text.tertiary}>
          Y: weekly points (Sleeper optimal lineup)
        </text>
        <text x={w / 2} y={h - 2} textAnchor="middle" fontSize={11} fill={theme.text.tertiary}>
          X: NFL week index across 2024 → 2026
        </text>
      </svg>
      <Row style={{ gap: 16, marginTop: 8 }}>
        {([2024, 2025, 2026] as const).map((yr) => (
          <Row key={yr} style={{ gap: 6, alignItems: 'center' }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: seasonFill[yr] }} />
            <Text tone="secondary">{yr}</Text>
          </Row>
        ))}
        <Text tone="tertiary">Larger dots = 190+ pts</Text>
      </Row>
    </div>
  );
}

export default function HwangWeeklyScoresCanvas() {
  const [filter, setFilter] = useCanvasState<SeasonFilter>('seasonFilter', 'all');
  const weekly2024 = WEEKLY['2024'].map((r) => r.avg ?? 0);
  const weekly2025 = WEEKLY['2025'].map((r) => r.avg ?? 0);
  const weekly2026 = WEEKLY['2026'].map((r) => (r.avg == null ? 0 : r.avg));

  return (
    <Stack style={{ gap: 24, padding: 8 }}>
      <div>
        <H1>Hwang Dynasty — every weekly team score</H1>
        <Text tone="secondary">
          Source: Sleeper matchup points · 2024–2026 · {STATS.n} team-weeks
        </Text>
      </div>

      <Grid columns={4} style={{ gap: 12 }}>
        <Stat label="Team-weeks" value={String(STATS.n)} />
        <Stat label="League mean" value={STATS.mean + ' pts'} tone="info" />
        <Stat label="Low" value={STATS.min + ' pts'} tone="warning" />
        <Stat label="Record high" value={STATS.max + ' pts'} tone="success" />
      </Grid>

      <Card>
        <CardHeader>Distribution of weekly scores</CardHeader>
        <CardBody>
          <Text tone="tertiary" style={{ marginBottom: 8 }}>
            10-point bins · all seasons
          </Text>
          <BarChart
            categories={HIST.labels}
            series={[{ name: 'Team-weeks', data: HIST.counts, tone: 'info' }]}
            height={220}
          />
          <Text tone="tertiary" style={{ marginTop: 8 }}>
            X: points bin (lower bound, pts). Y: count of team-weeks. Most weeks land 120–165; the 230+ bar is the 2025 nuclear duo only.
          </Text>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>Every score in time order</CardHeader>
        <CardBody>
          <Row style={{ gap: 8, marginBottom: 12 }}>
            {(['all', '2024', '2025', '2026'] as SeasonFilter[]).map((s) => (
              <Pill key={s} active={filter === s} onClick={() => setFilter(s)}>
                {s === 'all' ? 'All seasons' : s}
              </Pill>
            ))}
          </Row>
          <ScoreScatter filter={filter} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>League-average weekly points by season</CardHeader>
        <CardBody>
          <Text tone="tertiary" style={{ marginBottom: 8 }}>
            Mean across 10 teams each week
          </Text>
          <LineChart
            categories={WEEK_CATS}
            series={[
              { name: '2024', data: weekly2024, tone: 'info' },
              { name: '2025', data: weekly2025, tone: 'neutral' },
              { name: '2026', data: weekly2026, tone: 'success' },
            ]}
            height={240}
            referenceLines={[{ value: STATS.mean, label: 'all-time mean ' + STATS.mean, tone: 'info' }]}
          />
          <Text tone="tertiary" style={{ marginTop: 8 }}>
            X: NFL week (1–17). Y: mean weekly points (pts). 2026 is partial through week 10.
          </Text>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>Weekly high and low by season</CardHeader>
        <CardBody>
          <Text tone="tertiary" style={{ marginBottom: 8 }}>
            Max and min team score each week
          </Text>
          <LineChart
            categories={WEEK_CATS}
            series={[
              { name: '2024 max', data: WEEKLY['2024'].map((r) => r.max ?? 0), tone: 'info' },
              { name: '2024 min', data: WEEKLY['2024'].map((r) => r.min ?? 0), tone: 'info' },
              { name: '2025 max', data: WEEKLY['2025'].map((r) => r.max ?? 0), tone: 'neutral' },
              { name: '2025 min', data: WEEKLY['2025'].map((r) => r.min ?? 0), tone: 'neutral' },
            ]}
            height={260}
            beginAtZero={false}
            yMin={30}
          />
          <Text tone="tertiary" style={{ marginTop: 8 }}>
            Y: points (pts). 2025 weeks 14 and 16 max lines jump to league-record territory; mins show the spread in the same week.
          </Text>
        </CardBody>
      </Card>

      <div>
        <H2>All-time single-week top 20</H2>
        <Table
          headers={['#', 'Pts', 'Team', 'When']}
          columnAlign={['left', 'right', 'left', 'left']}
          rows={TOP.map((r, i) => [
            String(i + 1),
            r.pts.toFixed(1),
            r.team,
            r.season + ' W' + r.week,
          ])}
        />
      </div>
    </Stack>
  );
}
`;

writeFileSync(out, body);
console.log('wrote', out, body.length, 'chars');