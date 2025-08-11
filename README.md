# dbb

This is a site for helping view scores for Sleeper bestball leagues in browser since Sleeper itself doesn't support score checking.

## Setup

To configure this for your league, you must create a file at **settings/settings.json** and populate it.

**IMPORTANT**: Once you've added your settings.json file, you must run `./build_settings.sh` to load it into the local environment variables.

### Mandatory settings fields

You MUST set your LEADUE_ID and STARTER_POSITION_NAMES in order for the site to work. Example:

```
{
    "LEAGUE_ID": "<YOUR_SLEEPER_LEAGUE_ID>",

    "STARTER_POSITION_NAMES": [
        "QB1",
        "RB1",
        "RB2",
        "RB3",
        "WR1",
        "WR2",
        "WR3",
        "TE1",
        "FLEX1",
        "FLEX2",
        "SUPER"
    ],
}
```

Optionally you can add additional metadata in the following fields to give more features to the site:
- PREVIOUS_YEARS: To link your "league id" from previous years to import analytics.
- PREVIOUS_ROSTER_OVERRIDES: If a team's owner has changed you can add this data for previous years.
- PLAYER_ESPN_MAP_OVERRIDES: If you're failing to render any specific player's avatar
- SEASON_START_DATE: Set to first TNF game so the site is aware what NFL week we're in

Examples:
```
    "PREVIOUS_YEARS": {
        "2024": "<YOUR_PREVIOUS_YEAR_ID>"
    },
    "PREVIOUS_ROSTER_OVERRIDES": {
        "2024": {
            "2": {
                "owner": "some_username",
                "name": "Some team name",
                "avatar": "15d7cf259bc30eab8f6120f45f652fb6"
            }
        }
    },
    "PLAYER_ESPN_MAP_OVERRIDES": {
        "11562": "4426339"
    },
    "SEASON_START_DATE": "09/04"
```

**IMPORTANT**: Once you've added your settings.json file, you must run `./build_settings.sh` to load it into the local environment variables.

## Running the app

```
npm start --prefix site
```

## Deploying


To deploy via Vercel, just import as "Create React App", and set the environment variables equal to what's stored locally at site/.env.local (after running the settings script above)