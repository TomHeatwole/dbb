import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import PosValueCompare from '../posValueCompare/PosValueCompare';
import ArchetypeRosterBuilder from '../archetypeRosterBuilder/ArchetypeRosterBuilder';
import HwangTrueSimulator from '../hwangTrueSimulator/HwangTrueSimulator';

const FEATURES = [
  {
    id: 'HWANG_TRUE_SIMULATOR',
    label: 'Hwang True Simulator',
    description: 'Plug every value-matched cross-position pair (±5% KTC) into archetype rosters across 2021–2025 and tally true roster HVORP by position group.',
    component: <HwangTrueSimulator />,
  },
  {
    id: 'ARCHETYPE_ROSTER_BUILDER',
    label: 'Archetype Roster Builder',
    description: 'Instantiate real Hwang roster archetypes into historical seasons with rank jitter (HVORP groundwork).',
    component: <ArchetypeRosterBuilder />,
  },
  {
    id: 'POS_VALUE_COMPARE',
    label: 'Pos Value Compare',
    description: 'Cross-position HVORP vs Final KTC or Competitor Adjusted Value (top 300, 2021–2025).',
    component: <PosValueCompare />,
  },
];

function ValueSandboxPage() {
  const [activeFeatureId, setActiveFeatureId] = useState(null);

  const activeFeature = FEATURES.find(f => f.id === activeFeatureId);

  if (activeFeature) {
    return (
      <InfoPageWrapper
        title={activeFeature.label}
        subtitle="Value Sandbox"
        leftHeader={
          <button className="sandbox-back-btn" onClick={() => setActiveFeatureId(null)}>
            ← Back
          </button>
        }
      >
        {activeFeature.component}
      </InfoPageWrapper>
    );
  }

  return (
    <InfoPageWrapper
      title="Value Sandbox"
      subtitle="Positional Value Research"
      leftHeader={
        <Link to="/sandbox" className="sandbox-back-btn">
          ← Sandbox
        </Link>
      }
    >
      <div className="sandbox-menu">
        {FEATURES.map(feature => (
          <button
            key={feature.id}
            className="sandbox-feature-card"
            onClick={() => setActiveFeatureId(feature.id)}
          >
            <span className="sandbox-feature-label">{feature.label}</span>
            <span className="sandbox-feature-desc">{feature.description}</span>
          </button>
        ))}
      </div>
    </InfoPageWrapper>
  );
}

export default ValueSandboxPage;
