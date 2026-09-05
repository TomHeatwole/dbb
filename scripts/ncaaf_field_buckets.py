"""Shared NCAAF field / down / clock bins for the drive-situation project.

Field buckets (ESPN yards-to-goal: 95 = own 5, 25 = opp 25):

  deep       inside own 15          ytg 86–99
  kickoff    own 15–30, or a kickoff start
  midfield   own 31 through opp 45  ytg 45–69
             (user said “35 to opp 45”; own 31–34 is folded in so
             every yard line belongs to exactly one bucket)
  favorable  already inside opp 45  ytg 1–44
"""

FP_BUCKETS = (
    ('deep', 'Deep (inside own 15)', 86, 99),
    ('kickoff', 'Kickoff / own 15–30', 70, 85),
    ('midfield', 'Midfield (own 31–opp 45)', 45, 69),
    ('favorable', 'Favorable (inside opp 45)', 1, 44),
)
FP_IDS = tuple(k for k, *_ in FP_BUCKETS)

DIST_BINS = (
    ('short', 1, 3),
    ('med', 4, 6),
    ('long', 7, 10),
    ('xlong', 11, 99),
)
DIST_IDS = tuple(k for k, *_ in DIST_BINS)

TIME_BINS = ('late', 'mid', 'early')
HALF_BINS = ('h1', 'h2', 'ot')
POINT_VALUES = (0, 3, 6, 7, 8)


def fp_bucket(ytg):
    try:
        y = int(ytg)
    except (TypeError, ValueError):
        return None
    if y >= 86:
        return 'deep'
    if y >= 70:
        return 'kickoff'
    if y >= 45:
        return 'midfield'
    if y >= 1:
        return 'favorable'
    return None


def next_fp_bucket(ytg, started_with_kickoff=False):
    if started_with_kickoff:
        return 'kickoff'
    return fp_bucket(ytg)


def dist_bin(distance):
    try:
        d = int(distance)
    except (TypeError, ValueError):
        return None
    if d <= 3:
        return 'short'
    if d <= 6:
        return 'med'
    if d <= 10:
        return 'long'
    return 'xlong'


def time_bin(sec_left_half):
    if sec_left_half in (None, ''):
        return None
    try:
        s = int(sec_left_half)
    except (TypeError, ValueError):
        return None
    if s <= 180:
        return 'late'
    if s <= 480:
        return 'mid'
    return 'early'


def half_bin(period):
    try:
        p = int(period)
    except (TypeError, ValueError):
        return None
    if p in (1, 2):
        return 'h1'
    if p in (3, 4):
        return 'h2'
    if p > 4:
        return 'ot'
    return None
