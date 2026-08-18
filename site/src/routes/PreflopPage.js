import React, { useState, useMemo } from 'react';
import {
  POSITIONS,
  SCENARIOS,
  RFI,
  VS_RFI,
} from '../poker/ranges';
import { describeSpot } from '../poker/quiz';
import { PokerTable, RangeStats, HandGrid } from './PreflopShared';
import PreflopQuiz from './PreflopQuiz';
import PreflopPlayer from './PreflopPlayer';
import './PreflopPage.css';

export default function PreflopPage() {
  const [mode, setMode] = useState('charts');
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [myPos, setMyPos] = useState('CO');
  const [villainPos, setVillainPos] = useState('');
  const [pickMode, setPickMode] = useState('pick_hero');

  const scenario = SCENARIOS[scenarioIdx];
  const effectiveMyPos = scenario.fixedMyPos || myPos;
  const myIdx = POSITIONS.indexOf(effectiveMyPos);

  const validVillainPositions = useMemo(() => {
    if (!scenario.needsVillainPos) return [];

    if (scenario.id === 'vs_rfi') {
      return POSITIONS.filter((pos, i) => i < myIdx && (VS_RFI[`${effectiveMyPos} vs ${pos}`] || (effectiveMyPos === 'BB' && pos === 'SB')));
    }
    if (scenario.id === 'vs_3bet') {
      return POSITIONS.filter((_, i) => i > myIdx);
    }
    if (scenario.id === 'vs_4bet') {
      return POSITIONS.filter((_, i) => i < myIdx);
    }
    return POSITIONS.filter((p) => p !== effectiveMyPos);
  }, [scenario, effectiveMyPos, myIdx]);

  const displayMeta = useMemo(() => {
    if (scenario.id === 'rfi') {
      return {
        chart: RFI[effectiveMyPos] || null,
        actionLabels: scenario.actionLabels,
        actionColors: scenario.actionColors,
        description: scenario.description,
      };
    }

    if (scenario.id === 'vs_rfi') {
      if (!villainPos) {
        return {
          chart: null,
          actionLabels: scenario.actionLabels,
          actionColors: scenario.actionColors,
          description: scenario.description,
        };
      }
      const chart = effectiveMyPos === 'BB' && villainPos === 'SB'
        ? VS_RFI['BB vs SB']
        : VS_RFI[`${effectiveMyPos} vs ${villainPos}`] || null;
      return {
        chart,
        actionLabels: scenario.actionLabels,
        actionColors: scenario.actionColors,
        description: scenario.description,
      };
    }

    return {
      chart: villainPos ? scenario.getChart(effectiveMyPos, villainPos) : null,
      actionLabels: scenario.actionLabels,
      actionColors: scenario.actionColors,
      description: scenario.description,
    };
  }, [scenario, effectiveMyPos, villainPos]);

  const { chart, actionLabels, actionColors, description } = displayMeta;

  const handleScenarioChange = (idx) => {
    setScenarioIdx(idx);
    setVillainPos('');
    setPickMode('pick_hero');
  };

  const handleClickSeat = (pos) => {
    if (pickMode === 'pick_hero') {
      setMyPos(pos);
      setVillainPos('');
      if (scenario.needsVillainPos) {
        setPickMode('pick_villain');
      }
    } else {
      if (pos === myPos) {
        setVillainPos('');
        setPickMode('pick_hero');
      } else if (validVillainPositions.includes(pos)) {
        setVillainPos(pos);
      }
    }
  };

  const effectivePickMode = scenario.needsVillainPos ? pickMode : 'pick_hero';

  const handleClickSeatWrapped = (pos) => {
    if (villainPos && pos === villainPos) {
      setVillainPos('');
      setPickMode('pick_villain');
      return;
    }
    if (villainPos && pos === myPos) {
      setVillainPos('');
      setPickMode('pick_hero');
      return;
    }
    if (villainPos && pos !== myPos && pos !== villainPos) {
      setMyPos(pos);
      setVillainPos('');
      if (scenario.needsVillainPos) {
        setPickMode('pick_villain');
      }
      return;
    }
    handleClickSeat(pos);
  };

  const promptText = useMemo(() => {
    if (scenario.fixedMyPos) return null;
    if (!scenario.needsVillainPos) {
      return describeSpot({ scenarioId: scenario.id, myPos: effectiveMyPos, villainPos: '' });
    }
    if (effectivePickMode === 'pick_hero') {
      if (scenario.id === 'vs_3bet') return 'Select your seat — you opened from here.';
      if (scenario.id === 'vs_4bet') return 'Select your seat — you 3-bet from here.';
      return 'Select your seat.';
    }
    if (!villainPos) {
      if (scenario.id === 'vs_rfi') return 'Tap who opened.';
      if (scenario.id === 'vs_3bet') return 'Tap who 3-bet.';
      if (scenario.id === 'vs_4bet') return 'Tap who 4-bet.';
      return 'Tap the opponent.';
    }
    return describeSpot({ scenarioId: scenario.id, myPos: effectiveMyPos, villainPos });
  }, [scenario, effectivePickMode, villainPos, effectiveMyPos]);

  return (
    <div className="preflop-page">
      <div className="preflop-header">
        <h1>$1/$3 Preflop Guide</h1>
        <p className="preflop-subtitle">100BB · Jonathan Little's Ranges</p>
        <div className="preflop-mode-btns">
          <button
            className={`preflop-scenario-btn${mode === 'charts' ? ' preflop-scenario-btn--active' : ''}`}
            onClick={() => setMode('charts')}
          >
            Charts
          </button>
          <button
            className={`preflop-scenario-btn${mode === 'quiz' ? ' preflop-scenario-btn--active' : ''}`}
            onClick={() => setMode('quiz')}
          >
            Quiz
          </button>
          <button
            className={`preflop-scenario-btn${mode === 'hands' ? ' preflop-scenario-btn--active' : ''}`}
            onClick={() => setMode('hands')}
          >
            Hands
          </button>
        </div>
      </div>

      {mode === 'quiz' ? (
        <PreflopQuiz onExit={() => setMode('charts')} />
      ) : mode === 'hands' ? (
        <PreflopPlayer onExit={() => setMode('charts')} />
      ) : (
        <>
          <div className="preflop-controls">
            <div className="preflop-control-group">
              <label className="preflop-label">Scenario</label>
              <div className="preflop-scenario-btns">
                {SCENARIOS.map((s, i) => (
                  <button
                    key={s.id}
                    className={`preflop-scenario-btn${i === scenarioIdx ? ' preflop-scenario-btn--active' : ''}`}
                    onClick={() => handleScenarioChange(i)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="preflop-desc">{description}</p>

          {promptText && (
            <p className="preflop-prompt">{promptText}</p>
          )}

          {!scenario.fixedMyPos && (
            <PokerTable
              myPos={myPos}
              villainPos={villainPos}
              pickMode={effectivePickMode}
              onClickSeat={handleClickSeatWrapped}
              validVillainPositions={validVillainPositions}
            />
          )}

          <RangeStats
            grid={chart}
            actionLabels={actionLabels}
            actionColors={actionColors}
          />

          <HandGrid
            grid={chart}
            actionColors={actionColors}
            actionLabels={actionLabels}
          />

          <div className="preflop-legend">
            {Object.entries(actionLabels).map(([key, label]) => (
              <div key={key} className="preflop-legend-item">
                <span
                  className="preflop-legend-swatch"
                  style={{ backgroundColor: actionColors[key] }}
                />
                {label}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
