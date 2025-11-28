import React from 'react';

function Yoffs2025Format({ selectedTab, onTabChange }) {
  const tabOptions = ['Bracket', 'Scores', 'Matchups'];

  return (
    <>
      <div className="team-tabs-bar">
        {tabOptions.map((tab) => (
          <button
            key={tab}
            className={`team-tab${selectedTab === tab ? ' team-tab-active' : ''}`}
            onClick={() => {
              if (onTabChange) {
                onTabChange(tab);
              }
            }}
            type="button"
          >
            {tab}
          </button>
        ))}
      </div>

      {selectedTab === 'Bracket' && (
        <div className="yoffs-bracket-todo">
          TODO: Bracket Format (2025 rules) view coming soon.
        </div>
      )}

      {selectedTab === 'Scores' && (
        <div className="yoffs-tab-placeholder">
          TODO: Playoff Scores tab.
        </div>
      )}

      {selectedTab === 'Matchups' && (
        <div className="yoffs-tab-placeholder">
          TODO: Playoff Matchups tab.
        </div>
      )}
    </>
  );
}

export default Yoffs2025Format;

