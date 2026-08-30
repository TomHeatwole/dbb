import { SIMULATE_MIDWEEK } from '../utils/global_constants';
import { CURRENT_YEAR } from '../utils/DateHelper';

export default function MidweekSimBanner({ season }) {
  if (!SIMULATE_MIDWEEK) {
    return null;
  }
  if (season != null && String(season) !== String(CURRENT_YEAR)) {
    return null;
  }
  return (
    <div className="info-banner warning" role="status">
      <span className="banner-icon" aria-hidden="true">🧪</span>
      Mid-week simulation is on — about half the games are Final, a few are live, the rest still show projections. Flip <code>SIMULATE_MIDWEEK</code> in <code>global_constants.js</code> to turn it off.
    </div>
  );
}
