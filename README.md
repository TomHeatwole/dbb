# dbb

This is a site for helping view scores for Sleeper bestball leagues in browser since Sleeper itself doesn't support score checking.

## Setup

To configure this for your league, you must create a file at site/src/global_constants.js
with the following values:

```
export const SITE_NAME = '<name of site>';
export const LEAGUE_ID = '<your_sleeper_league_id>';

// Optional:
export const PREVIOUS_YEARS = {
    2024: '<2024_leagee_id>',
    2023: '<2023 league_id>',
    . . .
};

```


## Running the app

```
npm start --prefix site
```
