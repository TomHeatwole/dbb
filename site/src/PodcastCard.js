import React from 'react';
import HomeCard from './HomeCard';

const PODCAST_SHOW_ID = '0bM4EGBJzZcMTj3VOpNLko';

function PodcastCard() {
  return (
    <HomeCard>
      <div className="home-card-inner">
        <h2 className="home-card-title">🎙 Latest Podcast</h2>
        <div className="home-card-body">
          <iframe
            src={`https://open.spotify.com/embed/show/${PODCAST_SHOW_ID}`}
            width="100%"
            height="232"
            frameBorder="0"
            allow="encrypted-media"
            title="Latest DBB Podcast"
          />
        </div>
        <div className="active-playoffs-link-row">
          <a
            className="active-playoffs-link"
            href={`https://open.spotify.com/show/${PODCAST_SHOW_ID}`}
            target="_blank"
            rel="noreferrer"
          >
            Listen on Spotify →
          </a>
        </div>
      </div>
    </HomeCard>
  );
}

export default PodcastCard;



