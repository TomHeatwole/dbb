import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import { trackPageLoad } from '../utils/UsageTracker';
import { useSearchParams, Link } from 'react-router-dom';
import { PREVIOUS_YEARS } from '../utils/global_constants';
import { CURRENT_YEAR, getDefaultDisplayWeek, getCurrentNFLWeek } from '../utils/DateHelper';
import WeekSelector from '../scores/WeekSelector';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import { getWeekScoreBreakdown, getStandings, getPlayerSeasonTotalsMap } from '../scores/ScoresParser';
import { StartSitSort } from '../players/StartSitDecider';
import { startSitWithProjections } from '../scores/projectionScoring';
import useWeeklyProjectedPoints from '../scores/useWeeklyProjectedPoints';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from '../lookups/PlayerLookup';
import useIsMobile from '../hooks/useIsMobile';
import MobileScaled from '../scores/MobileScaled';
import MobileTeamScoreSummary from '../scores/MobileTeamScoreSummary';
import LeagueScoresTeamBreakdown from '../scores/LeagueScoresTeamBreakdown';
import { fetchNflScoreboard } from '../lookups/GamesLookup';
import { mapPlayersToGames, getGameDisplayForTeam, isScoreboardWeekComplete } from '../scores/GamesParser';
import { fetchInjuriesForWeek } from '../lookups/InjuryLookup';
import { readPlayersSnapshot } from '../utils/database';
import PageMeta from '../PageMeta';
import YoffsLink from '../yoffs/YoffsLink';
import { createLiveScoresPoller } from '../utils/livePolling';
import LoadingState from '../LoadingState';
import { useMyRosterId, isMyRoster } from '../hooks/useAuthUser';

const OG_TITLE = 'Scores – The Hwang Dynasty';
const OG_DESCRIPTION = '';

// Hardcoded toggle to force show the Sleeper API banner
const show_sleeper_api_banner = false;

const allYears = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)].sort((a, b) => b - a);

function getAvailableYearsAndDefault() {
	return { availableYears: allYears, defaultSeason: CURRENT_YEAR };
}

function LeagueScores() {
	// Toggle: when true, keep the current mobile summary behavior; when false, render the full web breakdown on mobile
	const showFullScoreBreakdownOnMobile = false;
	const [searchParams, setSearchParams] = useSearchParams();
	const { availableYears, defaultSeason } = getAvailableYearsAndDefault();
	const urlYear = searchParams.get('year');
	const initialSeason = urlYear && availableYears.includes(urlYear) ? urlYear : defaultSeason;
	const [season, setSeason] = useState(initialSeason);
	const [dropdownOpen, setDropdownOpen] = useState(false);
	const dropdownRef = useRef(null);
	const urlWeek = parseInt(searchParams.get('week'), 10);
	const initialWeek = !isNaN(urlWeek) && urlWeek >= 1 && urlWeek <= 17 ? urlWeek : getDefaultDisplayWeek(season);
	const [week, setWeek] = useState(initialWeek);
	const [weeksParsedData, setWeeksParsedData] = useState(null);
	const [rosters, setRosters] = useState(null);
	const [users, setUsers] = useState(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [expanded, setExpanded] = useState({});
	const hasAnyExpanded = Object.values(expanded || {}).some(Boolean);
	const [playersData, setPlayersData] = useState(null);
	const [playerIdMap, setPlayerIdMap] = useState(null);
	const [benchOpen, setBenchOpen] = useState({});
	const isMobile = useIsMobile();
	const myRosterId = useMyRosterId(rosters, users);
	const [playerGameLabels, setPlayerGameLabels] = useState({});
	const [isWeekCompleteByGames, setIsWeekCompleteByGames] = useState(false);
	const [injuriesMap, setInjuriesMap] = useState({});
	const [apiDelayMinutes, setApiDelayMinutes] = useState(null); // null -> hide banner, number -> minutes delayed
	const lastDbEntryTsRef = useRef(null);
	const [prevData, setPrevData] = useState(null);
	const [teamHighlightMap, setTeamHighlightMap] = useState({}); // rosterId -> 'up'|'down'|'row'
	const [playerHighlightMap, setPlayerHighlightMap] = useState({}); // rosterId -> { playerId -> 'up'|'down' }
	const labelBaselineKeyRef = useRef(null);
	const [playersTeamMap, setPlayersTeamMap] = useState({}); // playerId -> team abbr (from weekly snapshot)

	const playerSeasonTotalsMap = useMemo(() => {
		return getPlayerSeasonTotalsMap(weeksParsedData);
	}, [weeksParsedData]);
	const projectedPtsById = useWeeklyProjectedPoints(season, week);

	const buildExpandedData = useCallback((srcWeeksParsedData, targetWeek, labels, seasonTotalsMap) => {
		if (!srcWeeksParsedData) { return null; }
		const breakdownByRoster = getWeekScoreBreakdown(srcWeeksParsedData, targetWeek) || {};
		const standings = getStandings(srcWeeksParsedData) || [];
		const rosterIdToPlace = {};
		for (const s of standings) {
			if (s && s.roster_id != null) {
				rosterIdToPlace[String(s.roster_id)] = s.place || 9999;
			}
		}
		const weekEntries = (Array.isArray(srcWeeksParsedData) && srcWeeksParsedData[targetWeek - 1] ? srcWeeksParsedData[targetWeek - 1] : [])
			.filter(e => e && e.roster_id != null);
		const rows = weekEntries.map((e) => {
			const rid = e.roster_id;
			const raw = breakdownByRoster[rid];
			const computed = raw ? startSitWithProjections(raw, playersData, playerIdMap, labels || playerGameLabels, injuriesMap, seasonTotalsMap, projectedPtsById) : null;
			const total = computed ? computed.starterTotal : (typeof e.points === 'number' ? Number(e.points.toFixed(2)) : 0);
			const starters = computed && Array.isArray(computed.starters) ? computed.starters.map(p => ({ id: String(p.id), pts: Number(p.pts || 0) })) : [];
			const bench = computed && Array.isArray(computed.bench) ? computed.bench.map(p => ({ id: String(p.id), pts: Number(p.pts || 0) })) : [];
			const standingPlace = rosterIdToPlace[String(rid)] || 9999;
			return { rosterId: String(rid), total, starters, bench, standingPlace };
		}).sort((a, b) => {
			if (b.total !== a.total) { return b.total - a.total; }
			// Tiebreaker: lower place number is better (1 before 2)
			const placeDiff = (a.standingPlace || 9999) - (b.standingPlace || 9999);
			if (placeDiff !== 0) { return placeDiff; }
			// Final deterministic tiebreaker
			return String(a.rosterId).localeCompare(String(b.rosterId));
		});
		const order = rows.map(r => r.rosterId);
		const teams = {};
		rows.forEach(r => { teams[r.rosterId] = { total: r.total, starters: r.starters, bench: r.bench }; });
		return { order, teams };
	}, [playersData, playerIdMap, playerGameLabels, injuriesMap, projectedPtsById]);

	function compareExpanded(prev, next) {
		if (!prev || !next) { return []; }
		const changes = [];
		// Order changes: compute per-roster index movement
		const prevIndex = {};
		const nextIndex = {};
		(prev.order || []).forEach((rid, i) => { if (rid != null) { prevIndex[rid] = i; } });
		(next.order || []).forEach((rid, i) => { if (rid != null) { nextIndex[rid] = i; } });
		const allRostersForPlacement = new Set([...(prev.order || []), ...(next.order || [])]);
		for (const rid of allRostersForPlacement) {
			const pi = prevIndex[rid];
			const ni = nextIndex[rid];
			if (typeof pi === 'number' && typeof ni === 'number' && pi !== ni) {
				changes.push({ type: 'placement', rosterId: rid, beforeIndex: pi, afterIndex: ni, direction: ni < pi ? 'up' : 'down' });
			}
		}
		const allRosters = new Set([...(prev.order || []), ...(next.order || [])]);
		for (const rid of allRosters) {
			const pa = prev.teams[rid] || { total: 0, starters: [], bench: [] };
			const pb = next.teams[rid] || { total: 0, starters: [], bench: [] };
			const beforeDisplay = Math.round(((pa.total || 0)) * 10) / 10;
			const afterDisplay = Math.round(((pb.total || 0)) * 10) / 10;
			if (beforeDisplay !== afterDisplay) {
				changes.push({ type: 'teamTotal', rosterId: rid, before: beforeDisplay, after: afterDisplay });
			}
			// starters by slot
			const maxSlots = Math.max(pa.starters.length, pb.starters.length);
			for (let s = 0; s < maxSlots; s++) {
				const sa = pa.starters[s] || { id: null, pts: 0 };
				const sb = pb.starters[s] || { id: null, pts: 0 };
				if (sa.id !== sb.id || Math.abs((sb.pts || 0) - (sa.pts || 0)) > 0.001) {
					changes.push({ type: 'starterSlot', rosterId: rid, slot: s, before: sa, after: sb });
				}
			}
			// bench membership/pts
			const mapA = new Map((pa.bench || []).map(p => [p.id, p.pts || 0]));
			const mapB = new Map((pb.bench || []).map(p => [p.id, p.pts || 0]));
			const ids = new Set([...mapA.keys(), ...mapB.keys()]);
			ids.forEach(pid => {
				const a = mapA.has(pid) ? mapA.get(pid) : null;
				const b = mapB.has(pid) ? mapB.get(pid) : null;
				if (a === null && b !== null) { changes.push({ type: 'benchAdd', rosterId: rid, playerId: pid, after: b }); }
				else if (a !== null && b === null) { changes.push({ type: 'benchRemove', rosterId: rid, playerId: pid, before: a }); }
				else if (a !== null && b !== null && Math.abs((b || 0) - (a || 0)) > 0.001) {
					changes.push({ type: 'benchPts', rosterId: rid, playerId: pid, before: a, after: b });
				}
			});
		}
		return changes;
	}

	useEffect(() => {
		if (!dropdownOpen) { return; }
		const handleClickOutside = (e) => {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
				setDropdownOpen(false);
			}
		};
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	}, [dropdownOpen]);

	useEffect(() => {
		if (urlYear && availableYears.includes(urlYear) && season !== urlYear) {
			setSeason(urlYear);
			setDropdownOpen(false);
		}
		if (!urlYear) {
			if (season !== CURRENT_YEAR) {
				setSeason(CURRENT_YEAR);
				setDropdownOpen(false);
			}
		}
		// eslint-disable-next-line
	}, [urlYear]);

	// Track previous season to detect actual changes (not initial mount)
	const prevSeasonRef = useRef(initialSeason);
	
	useEffect(() => {
		if (season === CURRENT_YEAR) {
			searchParams.delete('year');
			setSearchParams(searchParams, { replace: true });
		} else if (availableYears.includes(season)) {
			searchParams.set('year', season);
			setSearchParams(searchParams, { replace: true });
		}
		// Only reset week to default if season actually changed (not on initial mount)
		if (prevSeasonRef.current !== season) {
			const newWeek = getDefaultDisplayWeek(season);
			setWeek(newWeek);
			prevSeasonRef.current = season;
		}
		// eslint-disable-next-line
	}, [season]);

	// sync week param
	useEffect(() => {
		const newParams = new URLSearchParams(searchParams);
		newParams.set('week', week);
		newParams.set('tab', 'Scores');
		setSearchParams(newParams, { replace: true });
		// eslint-disable-next-line
	}, [week]);

	useEffect(() => {
		if (!isNaN(urlWeek) && urlWeek >= 1 && urlWeek <= 17 && week !== urlWeek)  {
			setWeek(urlWeek);
		}
		// eslint-disable-next-line
	}, [urlWeek]);

	// Load league scores/teams for season
	useEffect(() => {
		trackPageLoad();
		setLoading(true);
		setError(null);
		Promise.all([
			fetchScoresData(season),
			fetchTeamData(season),
			null,
			fetchPlayerIdMap()
		])
			.then(async ([weeksData, teamData, _ignored, idMap]) => {
				const players = await fetchPlayersData(season === CURRENT_YEAR ? (teamData && teamData.rosters ? teamData.rosters : null) : String(season));
				setWeeksParsedData(weeksData);
				setRosters(teamData.rosters);
				setUsers(teamData.users);
				setPlayersData(players);
				setPlayerIdMap(idMap);
			})
			.catch(() => {
				setWeeksParsedData(null);
				setRosters(null);
				setUsers(null);
				setPlayersData(null);
				setPlayerIdMap(null);
				setError('Failed to load scores');
			})
			.finally(() => setLoading(false));
	}, [season]);

	// Load injuries map for season/week (used for past weeks rendering)
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const isCurrentSeason = String(season) === String(CURRENT_YEAR);
				const currentWeekNum = getCurrentNFLWeek();
				const isPreviousWeek = isCurrentSeason ? (Number(week) < currentWeekNum) : true;
				if (isPreviousWeek) {
					try {
						const snap = await (await import('../utils/database')).readPlayersSnapshot(season, week);
						const data = snap && snap.snapshot && snap.snapshot.data ? snap.snapshot.data : null;
						if (data && !cancelled) {
							const byPlayerId = {};
							for (const [pid, p] of Object.entries(data)) {
								const status = (p && (p.injury_status || p.injury_notes || (p.status && /out|pup|questionable|doubtful|suspended|ir|injured reserve|na/i.test(p.status) ? p.status : null))) || null;
								if (status) { byPlayerId[String(pid)] = String(status); }
							}
							setInjuriesMap(byPlayerId);
							return;
						}
					} catch (_) {}
				}
				// fallback to file-based; include both espnId and mapped playerId keys when possible
				const m = await fetchInjuriesForWeek(season, week);
				if (!cancelled) {
					let combined = { ...(m || {}) };
					try {
						if (playerIdMap && typeof playerIdMap === 'object') {
							for (const [pid, mapping] of Object.entries(playerIdMap)) {
								const espnId = mapping && (mapping.espn_id || (mapping.metadata && mapping.metadata.espn_id));
								if (espnId && combined[String(espnId)] && !combined[String(pid)]) {
									combined[String(pid)] = combined[String(espnId)];
								}
							}
						}
					} catch (_) {}
					setInjuriesMap(combined);
				}
			} catch (_) {
				if (!cancelled) { setInjuriesMap({}); }
			}
		})();
		return () => { cancelled = true; };
	}, [season, week, playerIdMap]);

	// Compute player->game labels for the selected week (web tables)
	useEffect(() => {
		if (!playersData || !playerIdMap || !weeksParsedData) {
			setIsWeekCompleteByGames(false);
			return;
		}
		const weekArr = Array.isArray(weeksParsedData) ? weeksParsedData[week - 1] : null;
		if (!Array.isArray(weekArr)) {
			setIsWeekCompleteByGames(false);
			return;
		}
		const playerIdSet = new Set();
		for (const entry of weekArr) {
			if (entry) {
				let playersArray = entry.players;
				// If players array is empty/missing, fall back to roster data
				if ((!playersArray || playersArray.length === 0) && rosters && Array.isArray(rosters)) {
					const roster = rosters.find(r => r && Number(r.roster_id) === Number(entry.roster_id));
					if (roster && Array.isArray(roster.players)) {
						playersArray = roster.players;
					}
				}
				if (Array.isArray(playersArray)) {
					for (const pid of playersArray) { playerIdSet.add(pid); }
				}
			}
		}
		const playerIds = Array.from(playerIdSet);
		if (playerIds.length === 0) {
			setPlayerGameLabels({});
			setIsWeekCompleteByGames(false);
			return;
		}

				const seasonYear = Number(season);
		let cancelled = false;
		fetchNflScoreboard(seasonYear, week)
					.then(async (json) => {
				if (cancelled) { return; }
				try {
					setIsWeekCompleteByGames(isScoreboardWeekComplete(json));
				} catch (_) {
					setIsWeekCompleteByGames(false);
				}
						let mapping = await mapPlayersToGames(playerIds, playersData, playerIdMap, json, (String(season) === String(CURRENT_YEAR) ? playersTeamMap : null));
				const labels = {};
				for (const pid of playerIds) {
					const item = mapping[pid];
					const ev = item && item.event;
					const teamForWeek = item && item.team;
					const d = ev ? getGameDisplayForTeam(ev, teamForWeek) : { text: 'BYE', live: false };
					const eventId = ev && ev.id ? String(ev.id) : null;
					labels[pid] = { ...d, team: teamForWeek || null, eventId };
				}
				if (!cancelled) { setPlayerGameLabels(labels); }
			})
			.catch(() => {
				if (!cancelled) {
					setPlayerGameLabels({});
					setIsWeekCompleteByGames(false);
				}
			});
		return () => { cancelled = true; };
	}, [season, week, playersData, playerIdMap, weeksParsedData, rosters, playersTeamMap]);

	// Align prevData baseline with first-loaded playerGameLabels for this season/week
	useEffect(() => {
		if (!weeksParsedData) { return; }
		const labelsCount = Object.keys(playerGameLabels || {}).length;
		if (labelsCount === 0) { return; }
		const key = `${season}-${week}`;
		if (labelBaselineKeyRef.current !== key) {
		try {
			const baseline = buildExpandedData(weeksParsedData, week, playerGameLabels, playerSeasonTotalsMap);
			setPrevData(baseline);
		} catch (_) {}
			labelBaselineKeyRef.current = key;
		}
	}, [playerGameLabels, weeksParsedData, season, week, buildExpandedData, playerSeasonTotalsMap]);

	// Load per-player team mapping from weekly players snapshot (current season only)
	// Live polling effect has intentionally curated dependencies; suppress
	// exhaustive-deps noise for this complex flow.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const isCurrentSeason = String(season) === String(CURRENT_YEAR);
				if (!isCurrentSeason || !week || Number(week) < 1) { if (!cancelled) setPlayersTeamMap({}); return; }
				const snap = await readPlayersSnapshot(String(season), Number(week));
				const data = snap && snap.snapshot && snap.snapshot.data ? snap.snapshot.data : null;
				if (cancelled) { return; }
				if (!data) { setPlayersTeamMap({}); return; }
				const next = {};
				for (const [pid, pinfo] of Object.entries(data)) {
					const abbr = pinfo && (pinfo.team || pinfo.team_abbr || pinfo.team_abbreviation);
					if (abbr) { next[String(pid)] = String(abbr); }
				}
				setPlayersTeamMap(next);
			} catch (_) { if (!cancelled) setPlayersTeamMap({}); }
		})();
		return () => { cancelled = true; };
	}, [season, week]);

	// Reset label baseline key on season/week change
	useEffect(() => {
		labelBaselineKeyRef.current = null;
	}, [season, week]);

	// Poll for score updates using shared live polling helper; only active while
	// this route is mounted and the tab is visible.
	useEffect(() => {
		let cancelled = false;

		const poller = createLiveScoresPoller({
			season,
			week,
			forceOnStartAndFocus: true,
			onData: ({ newWeeks, dbEntryTs }) => {
				if (cancelled || !Array.isArray(newWeeks)) {
					return;
				}
				const seasonTotals = getPlayerSeasonTotalsMap(newWeeks);
				const nextExpanded = buildExpandedData(
					newWeeks,
					week,
					playerGameLabels,
					seasonTotals
				);
				let changes = [];
				if (prevData) {
					changes = compareExpanded(prevData, nextExpanded);
				}
				const prevTs = lastDbEntryTsRef.current;
				if ((dbEntryTs != null && prevTs !== dbEntryTs) || changes.length > 0) {
					setWeeksParsedData(newWeeks);
					lastDbEntryTsRef.current = dbEntryTs != null ? dbEntryTs : prevTs;
					setPrevData(nextExpanded);
					const nextTeamMap = {};
					const nextPlayerMap = {};
					for (const ch of changes) {
						if (ch.type === 'teamTotal') {
							const dir = (ch.after || 0) > (ch.before || 0) ? 'up' : 'down';
							nextTeamMap[String(ch.rosterId)] = dir;
						} else if (ch.type === 'starterSlot') {
							const beforePts =
								ch.before && typeof ch.before.pts === 'number' ? ch.before.pts : 0;
							const afterPts =
								ch.after && typeof ch.after.pts === 'number' ? ch.after.pts : 0;
							const pid =
								ch.after && ch.after.id
									? String(ch.after.id)
									: ch.before && ch.before.id
									? String(ch.before.id)
									: null;
							if (pid) {
								const dir =
									afterPts > beforePts
										? 'up'
										: afterPts < beforePts
										? 'down'
										: null;
								if (dir) {
									const rid = String(ch.rosterId);
									if (!nextPlayerMap[rid]) {
										nextPlayerMap[rid] = {};
									}
									nextPlayerMap[rid][pid] = dir;
								}
							}
						} else if (ch.type === 'benchPts') {
							const dir = (ch.after || 0) > (ch.before || 0) ? 'up' : 'down';
							const rid = String(ch.rosterId);
							if (!nextPlayerMap[rid]) {
								nextPlayerMap[rid] = {};
							}
							nextPlayerMap[rid][String(ch.playerId)] = dir;
						} else if (ch.type === 'placement') {
							if (ch.direction === 'up') {
								// Do not mark 'row' for totals; only row pulse, not total color
								nextTeamMap[String(ch.rosterId)] = 'row';
							}
						}
					}
					if (changes.length > 0) {
						setTeamHighlightMap(nextTeamMap);
						setPlayerHighlightMap(nextPlayerMap);
						setTimeout(() => {
							setTeamHighlightMap({});
							setPlayerHighlightMap({});
						}, 3000);
					}
				}
			},
			onDelayMinutesChange: (mins) => {
				setApiDelayMinutes(mins);
			},
		});

		poller.start();

		return () => {
			cancelled = true;
			poller.stop();
		};
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [season, week, playerGameLabels, buildExpandedData, prevData]);


	function getTeamName(rosterId) {
		if (!rosters || !users) return `Team ${rosterId}`;
		const roster = rosters.find(r => String(r.roster_id) === String(rosterId));
		if (!roster) return `Team ${rosterId}`;
		const user = users.find(u => String(u.user_id) === String(roster.owner_id));
		if (user && user.metadata && user.metadata.team_name) return user.metadata.team_name;
		if (user && user.display_name) return `Team ${user.display_name}`;
		return `Team ${rosterId}`;
	}

	function getAvatar(rosterId) {
		if (!rosters || !users) return null;
		const roster = rosters.find(r => String(r.roster_id) === String(rosterId));
		if (!roster) return null;
		const user = users.find(u => String(u.user_id) === String(roster.owner_id));
		if (!user) return null;
		// Prefer team avatar when available; fallback to user avatar
		return user.team_avatar_url || user.user_avatar_url || user.avatar_url || null;
	}

	function toggleExpand(rosterId) {
		setExpanded(prev => ({ ...prev, [rosterId]: !prev[rosterId] }));
	}
	function toggleBench(rosterId) {
		setBenchOpen(prev => ({ ...prev, [rosterId]: !prev[rosterId] }));
	}

	const leftHeader = (
		<div
			ref={dropdownRef}
			className="team-season-dropdown"
			onClick={() => setDropdownOpen(open => !open)}
		>
			{season}
			<span className="team-season-dropdown-arrow">{dropdownOpen ? '▲' : '▼'}</span>
			{dropdownOpen && (
				<div className="team-season-dropdown-list" onClick={(e) => e.stopPropagation()}>
					{availableYears.map(opt => (
						<div
							key={opt}
							className={'team-scores-week-dropdown-option' + (opt === season ? ' team-scores-week-dropdown-option-active' : '')}
							onClick={() => {
								setSeason(opt);
								setDropdownOpen(false);
							}}
						>
							{opt}
						</div>
					))}
				</div>
			)}
		</div>
	);

	return (
		<>
			<PageMeta
				title={OG_TITLE}
				description={OG_DESCRIPTION}
			/>
		<InfoPageWrapper title="Scores" subtitle={null} leftHeader={leftHeader}>
			<div className="team-scores-container">
				<WeekSelector week={week} onChange={setWeek} />
			</div>
			{week >= 15 ? <YoffsLink /> : null}
			{loading ? (
				<LoadingState label="Loading scores…" />
			) : error || !weeksParsedData || !rosters || !users ? (
				<div>Error loading scores.</div>
			) : (
				<div className={`standings-list standings-list--scores${hasAnyExpanded ? ' standings-list--expanded' : ''}`}>
					{(show_sleeper_api_banner || apiDelayMinutes != null) ? (
						<div className="info-banner warning">
							<span className="banner-icon" aria-hidden="true">⚠️</span>
							Sleeper API stopped responding:  data delayed by {apiDelayMinutes != null ? apiDelayMinutes : 'unknown'} minute{apiDelayMinutes === 1 ? '' : 's'}.
						</div>
					) : null}
					{(() => {
						const breakdownByRoster = getWeekScoreBreakdown(weeksParsedData, week) || {};
						const weekEntries = (Array.isArray(weeksParsedData) && weeksParsedData[week - 1] ? weeksParsedData[week - 1] : [])
							.filter(e => e && e.roster_id != null);
						// Build standings order for tie-breaks (roster_id -> place)
						const standingsArr = getStandings(weeksParsedData) || [];
						const placeByRosterIdBase = {};
						const basePointsByRoster = {};
						for (const r of standingsArr) {
							if (r && r.roster_id != null) {
								placeByRosterIdBase[String(r.roster_id)] = r.place || 9999;
								basePointsByRoster[String(r.roster_id)] = typeof r.points_scored === 'number' ? r.points_scored : 0;
							}
						}
						// Live-inclusive place (current season only) using StartSitSort like TeamOverview
						let placeByRosterIdLive = null;
						let liveTotalByRosterId = null;
						try {
							const isCurrentSeason = String(season) === String(CURRENT_YEAR);
							if (isCurrentSeason && playersData && playerIdMap) {
								const currentWeekNum = getCurrentNFLWeek();
								const currentBreakdown = getWeekScoreBreakdown(weeksParsedData, currentWeekNum) || {};
								const totals = (standingsArr || []).map((s) => {
									const raw = currentBreakdown[s.roster_id];
									let liveTotal = s.points_scored || 0;
									if (raw) {
										const computed = StartSitSort(raw, playersData, playerIdMap, null, injuriesMap, playerSeasonTotalsMap);
										if (computed && typeof computed.starterTotal === 'number') {
											const priorWeeks = (weeksParsedData || []).slice(0, currentWeekNum - 1) || [];
											const priorSum = priorWeeks.reduce((sum, wk) => {
												if (!Array.isArray(wk)) { return sum; }
												const e = wk.find(x => x && Number(x.roster_id) === Number(s.roster_id));
												const pts = e && typeof e.points === 'number' ? e.points : 0;
												return sum + pts;
											}, 0);
											liveTotal = Math.round((priorSum + computed.starterTotal) * 10) / 10;
										}
									}
									return { roster_id: s.roster_id, liveTotal };
								}).sort((a, b) => b.liveTotal - a.liveTotal);
								// Tie-aware placement
								placeByRosterIdLive = {};
								liveTotalByRosterId = {};
								let place = 1; let i = 0;
								while (i < totals.length) {
									const score = totals[i].liveTotal;
									let j = i + 1;
									while (j < totals.length && totals[j].liveTotal === score) { j++; }
									for (let k = i; k < j; k++) {
										placeByRosterIdLive[String(totals[k].roster_id)] = place;
										liveTotalByRosterId[String(totals[k].roster_id)] = totals[k].liveTotal;
									}
									place += (j - i);
									i = j;
								}
							}
						} catch (_) { placeByRosterIdLive = null; liveTotalByRosterId = null; }
						const computedEntries = weekEntries.map((e) => {
							const rid = e.roster_id;
							const raw = breakdownByRoster[rid];
							const computed = raw ? startSitWithProjections(raw, playersData, playerIdMap, playerGameLabels, injuriesMap, playerSeasonTotalsMap, projectedPtsById) : null;
							const pts = computed ? computed.starterTotal : (typeof e.points === 'number' ? Number(e.points.toFixed(2)) : 0);
							const place = (placeByRosterIdLive && placeByRosterIdLive[String(rid)]) || placeByRosterIdBase[String(rid)] || 9999;
							const pfTotal = (liveTotalByRosterId && liveTotalByRosterId[String(rid)] != null)
								? liveTotalByRosterId[String(rid)]
								: (basePointsByRoster[String(rid)] || 0);
							return { rosterId: rid, points: pts, place, pfTotal, breakdown: computed };
						}).sort((a, b) => {
							if (b.points !== a.points) { return b.points - a.points; }
							if ((a.place || 9999) !== (b.place || 9999)) { return (a.place || 9999) - (b.place || 9999); }
							return String(a.rosterId).localeCompare(String(b.rosterId));
						});
						return computedEntries.map(({ rosterId, points, place, pfTotal, breakdown }) => {
							const teamName = getTeamName(rosterId);
							const avatarUrl = getAvatar(rosterId);
							const isExpanded = !!expanded[rosterId];
								const weekBreakdown = breakdown;
							const benchTotal = weekBreakdown ? weekBreakdown.benchTotal : 0;
							const isActiveWeek =
								(String(season) === String(CURRENT_YEAR)) &&
								(Number(week) === Number(getCurrentNFLWeek())) &&
								!isWeekCompleteByGames;
							const showCurrentInjury = (String(season) === String(CURRENT_YEAR)) && (week >= getCurrentNFLWeek());

							let activeCount = 0;
							let yetToPlayCount = 0;
							if (isActiveWeek && weekBreakdown) {
								const rosterPlayerIds = [...weekBreakdown.starters, ...weekBreakdown.bench]
									.map((p) => p && p.id)
									.filter((pid) => pid && pid !== '0');
								for (const pid of rosterPlayerIds) {
									const label = (playerGameLabels && playerGameLabels[pid]) ? playerGameLabels[pid] : null;
									if (!label) { continue; }
									const isLive = !!label.live;
									const isCompleted = !!label.completed;
									const isBye = label && label.text === 'BYE';
									if (isLive) {
										activeCount += 1;
									} else if (!isCompleted && !isBye) {
										yetToPlayCount += 1;
									}
								}
							}

							// Debug: log players missing ESPN mapping (image source) for this team row
							try {
								if (weekBreakdown && playerIdMap) {
												const rows = [...(weekBreakdown.starters || []), ...(weekBreakdown.bench || [])];
									const missing = [];
									for (const p of rows) {
										const pid = String(p && p.id);
										if (!pid || pid === '0') { continue; }
										const mapping = playerIdMap[pid];
										const espnId = mapping && (mapping.espn_id || (mapping.metadata && mapping.metadata.espn_id));
										if (!espnId) {
											const info = getPlayerInfo(pid, playersData, playerIdMap);
											missing.push({ id: pid, name: (info && info.name) || pid });
										}
									}
									if (missing.length > 0) {
										/* removed noisy debug log */
									}
								}
							} catch (_) {}

							const teamHighlight = teamHighlightMap && teamHighlightMap[String(rosterId)];
							const rowClass = teamHighlight === 'row' ? ' standings-row--pulse' : (teamHighlight === 'up' ? ' standings-row--up' : (teamHighlight === 'down' ? ' standings-row--down' : ''));
							const mine = isMyRoster(rosterId, myRosterId);
							return (
								<div key={rosterId} className={`standings-row${rowClass}${mine ? ' standings-row--me' : ''}`}>
									<button className="standings-row-header" type="button" onClick={() => toggleExpand(rosterId)}>
										<span className={`standings-toggle-icon${isExpanded ? ' standings-toggle-icon--open' : ''}`}>{isExpanded ? '▾' : '▸'}</span>
										<span className="standings-rank" style={{ visibility: 'hidden' }}>#</span>
										{avatarUrl && <img className="standings-avatar" src={avatarUrl} alt={`${teamName} avatar`} />}
										<span className="standings-title">{teamName}{mine ? <span className="me-chip">YOU</span> : null}</span>
										{isActiveWeek && !isMobile ? (
											<span className="standings-activity">
												<span className="standings-activity-item">Yet to Play: {yetToPlayCount}</span>
												<span className="standings-activity-item">In-Play: {activeCount}</span>
											</span>
										) : null}
										{isActiveWeek && isMobile ? (
											<div className="standings-activity standings-activity-mobile">
												<span className="standings-activity-item">YTP {yetToPlayCount}</span>
												<span className="standings-activity-item">Live {activeCount}</span>
											</div>
										) : null}
										<span
											className={`standings-total${weekBreakdown && weekBreakdown.includesProjection ? ' standings-total--proj' : ''}${teamHighlight === 'up' ? ' text-up' : (teamHighlight === 'down' ? ' text-down' : '')}`}
											title={weekBreakdown && weekBreakdown.includesProjection ? 'Includes projections for players who have not played yet' : undefined}
										>
											{Number(points || 0).toFixed(1)}
											{weekBreakdown && weekBreakdown.includesProjection ? <span className="proj-tag"> proj</span> : ' pts'}
										</span>
									</button>
									{isExpanded && (
										<div className="standings-row-expand">
											<div className="team-expanded-banner">
												<div className="team-expanded-banner-left">
													<span className="team-expanded-label">Owner:</span>
													{(() => {
														const roster = rosters && rosters.find(r => String(r.roster_id) === String(rosterId));
														const owner = roster && users ? users.find(u => String(u.user_id) === String(roster.owner_id)) : null;
														const ownerName = owner && owner.display_name ? owner.display_name : teamName;
														const ownerAvatar = owner && (owner.user_avatar_url || owner.avatar_url || owner.team_avatar_url) ? (owner.user_avatar_url || owner.avatar_url || owner.team_avatar_url) : avatarUrl;
														const teamLink = `/team/${rosterId}${searchParams && searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
														return (
															<Link className="team-expanded-owner" to={teamLink}>
																{ownerAvatar ? <img className="team-expanded-owner-avatar" src={ownerAvatar} alt={`${ownerName} avatar`} /> : null}
																<span className="team-expanded-owner-name">{ownerName}</span>
															</Link>
														);
													})()}
												</div>
												<div className="team-expanded-banner-center">
													<Link className="team-expanded-place" to="/standings">Place: #{place || 9999} ({Number(pfTotal || 0).toFixed(1)} PF)</Link>
												</div>
												<div className="team-expanded-banner-right" />
											</div>
											{isMobile && showFullScoreBreakdownOnMobile ? (
												<MobileTeamScoreSummary
													weekBreakdown={weekBreakdown}
													week={week}
													rosterId={rosterId}
													searchParams={searchParams}
													isActiveWeek={isActiveWeek}
													activeCount={activeCount}
													yetToPlayCount={yetToPlayCount}
												/>
											) : (
												isMobile ? (
													<MobileScaled>
								<LeagueScoresTeamBreakdown
															weekBreakdown={weekBreakdown}
															week={week}
															rosterId={rosterId}
															benchOpen={!!benchOpen[rosterId]}
															onToggleBench={() => toggleBench(rosterId)}
															benchTotal={benchTotal}
															playersData={playersData}
															playerIdMap={playerIdMap}
															searchParams={searchParams}
															playerGameLabels={playerGameLabels}
															isActiveWeek={isActiveWeek}
															injuriesMap={injuriesMap}
															showCurrentInjury={showCurrentInjury}
									playerHighlightMap={playerHighlightMap && playerHighlightMap[String(rosterId)] ? playerHighlightMap[String(rosterId)] : {}}
									playersTeamMap={playersTeamMap}
														/>
													</MobileScaled>
												) : (
									<LeagueScoresTeamBreakdown
														weekBreakdown={weekBreakdown}
														week={week}
														rosterId={rosterId}
														benchOpen={!!benchOpen[rosterId]}
														onToggleBench={() => toggleBench(rosterId)}
														benchTotal={benchTotal}
														playersData={playersData}
														playerIdMap={playerIdMap}
														searchParams={searchParams}
														playerGameLabels={playerGameLabels}
														isActiveWeek={isActiveWeek}
														injuriesMap={injuriesMap}
														showCurrentInjury={showCurrentInjury}
										playerHighlightMap={playerHighlightMap && playerHighlightMap[String(rosterId)] ? playerHighlightMap[String(rosterId)] : {}}
										playersTeamMap={playersTeamMap}
													/>
												)
											)}
										</div>
									)}
								</div>
							);
						});
					})()}
				</div>
			)}
		</InfoPageWrapper>
		</>
	);
}

export default LeagueScores; 