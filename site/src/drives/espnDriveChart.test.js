import {
  currentDrivePlayMoved,
  liveSpotFromCurrentDrive,
  shouldApplyCurrentDriveSpot,
} from './espnDriveChart';

function oregonDriveAt45() {
  return {
    start: { text: 'ORE 22', yardsToEndzone: 78, yardLine: 22 },
    end: null,
    plays: [
      {
        start: {
          down: 1,
          distance: 10,
          yardLine: 22,
          yardsToEndzone: 78,
          possessionText: 'ORE 22',
          shortDownDistanceText: '1st & 10',
        },
        end: {
          down: 1,
          distance: 10,
          yardLine: 45,
          yardsToEndzone: 55,
          possessionText: 'ORE 45',
          shortDownDistanceText: '1st & 10',
        },
      },
      {
        start: {
          down: 1,
          distance: 10,
          yardLine: 45,
          yardsToEndzone: 55,
          possessionText: 'ORE 45',
          shortDownDistanceText: '1st & 10',
          downDistanceText: '1st & 10 at ORE 45',
        },
        end: {
          down: 2,
          distance: 10,
          yardLine: 45,
          yardsToEndzone: 55,
          possessionText: 'ORE 45',
          shortDownDistanceText: '2nd & 10',
          downDistanceText: '2nd & 10 at ORE 45',
        },
      },
    ],
  };
}

describe('liveSpotFromCurrentDrive', () => {
  it('uses the last play end, not the drive-start hash', () => {
    const spot = liveSpotFromCurrentDrive(oregonDriveAt45());
    expect(spot).toMatchObject({
      possessionText: 'ORE 45',
      yardsToEndzone: 55,
      down: 2,
      distance: 10,
      yardLine: 45,
      downDistance: '2nd & 10',
    });
    expect(currentDrivePlayMoved(oregonDriveAt45(), spot)).toBe(true);
  });

  it('replaces a header that is still the opening hash', () => {
    const drive = oregonDriveAt45();
    const spot = liveSpotFromCurrentDrive(drive);
    expect(shouldApplyCurrentDriveSpot('ORE 22', drive, spot)).toBe(true);
    expect(shouldApplyCurrentDriveSpot(null, drive, spot)).toBe(true);
  });

  it('keeps a header that is ahead of an un-updated play list', () => {
    const drive = {
      start: { text: 'ORE 22', yardsToEndzone: 78 },
      plays: [
        {
          end: {
            down: 1,
            distance: 10,
            yardsToEndzone: 78,
            possessionText: 'ORE 22',
          },
        },
      ],
    };
    const spot = liveSpotFromCurrentDrive(drive);
    expect(spot.possessionText).toBe('ORE 22');
    expect(shouldApplyCurrentDriveSpot('ORE 45', drive, spot)).toBe(false);
  });
});
