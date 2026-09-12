import { SIMULATE_MIDWEEK, SIMULATE_WEEK1_DONE } from '../utils/global_constants';
import { CURRENT_YEAR } from '../utils/DateHelper';

export default function MidweekSimBanner({ season }) {
  if (season != null && String(season) !== String(CURRENT_YEAR)) {
    return null;
  }
  if (SIMULATE_WEEK1_DONE) {
    return (
      <div className="info-banner warning" role="status">
        <span className="banner-icon" aria-hidden="true">🧪</span>
        Week 1 complete / Week 2 pregame simulation is on. Flip <code>SIMULATE_WEEK1_DONE</code> in <code>global_constants.js</code> to turn it off.
      </div>
    );
  }
  if (!SIMULATE_MIDWEEK) {
    return null;
  }
  return (
    <div className="info-banner warning" role="status">
      <span className="banner-icon" aria-hidden="true">🧪</span>
      Mid-week / mid-game simulation is on — a couple of games are Final, a couple are live (Q2 8:21), the rest still show pregame projections. Live outlook uses current score + remaining-time × pregame. Flip <code>SIMULATE_MIDWEEK</code> in <code>global_constants.js</code> to turn it off.
    </div>
  );
}
