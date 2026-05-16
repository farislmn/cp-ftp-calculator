type DistKey = '5k' | '10k' | 'halfMarathon' | 'marathon';

interface Band {
  '5k':          [number, number];
  '10k':         [number, number];
  halfMarathon:  [number, number];
  marathon:      [number, number];
  riegel: number;
}

interface DistanceData {
  distanceRange: [number, number];
  bands: Band[];
}

const riegelLookup: Record<DistKey, DistanceData> = {

  marathon: {
    distanceRange: [40929, 43461],
    bands: [
      { '5k': [0, 870],     '10k': [0, 1790],     halfMarathon: [0, 3990],       marathon: [0, 8400],        riegel: -0.06 },
      { '5k': [871, 990],   '10k': [1791, 2050],   halfMarathon: [3991, 4560],    marathon: [8401, 9600],     riegel: -0.07 },
      { '5k': [991, 1110],  '10k': [2051, 2300],   halfMarathon: [4561, 5130],    marathon: [9601, 10800],    riegel: -0.08 },
      { '5k': [1111, 1230], '10k': [2301, 2560],   halfMarathon: [5131, 5700],    marathon: [10801, 12000],   riegel: -0.09 },
      { '5k': [1231, 1350], '10k': [2561, 2810],   halfMarathon: [5701, 6270],    marathon: [12001, 13200],   riegel: -0.09 },
      { '5k': [1351, 1470], '10k': [2811, 3070],   halfMarathon: [6271, 6840],    marathon: [13201, 14400],   riegel: -0.10 },
      { '5k': [1471, 1600], '10k': [3071, 3325],   halfMarathon: [6841, 7410],    marathon: [14401, 15600],   riegel: -0.10 },
      { '5k': [1601, 1725], '10k': [3326, 3580],   halfMarathon: [7411, 7980],    marathon: [15601, 16800],   riegel: -0.11 },
      { '5k': [1726, 1860], '10k': [3581, 3840],   halfMarathon: [7981, 8550],    marathon: [16801, 18000],   riegel: -0.12 },
      { '5k': [1861, 7440], '10k': [3841, 15360],  halfMarathon: [8551, 34200],   marathon: [18001, 72000],   riegel: -0.12 },
    ],
  },

  halfMarathon: {
    distanceRange: [20465, 21731],
    bands: [
      { '5k': [0, 870],     '10k': [0, 1790],     halfMarathon: [0, 3990],       marathon: [0, 8400],        riegel: -0.05 },
      { '5k': [871, 990],   '10k': [1791, 2050],   halfMarathon: [3991, 4560],    marathon: [8401, 9600],     riegel: -0.06 },
      { '5k': [991, 1110],  '10k': [2051, 2300],   halfMarathon: [4561, 5130],    marathon: [9601, 10800],    riegel: -0.07 },
      { '5k': [1111, 1230], '10k': [2301, 2560],   halfMarathon: [5131, 5700],    marathon: [10801, 12000],   riegel: -0.08 },
      { '5k': [1231, 1350], '10k': [2561, 2810],   halfMarathon: [5701, 6270],    marathon: [12001, 13200],   riegel: -0.08 },
      { '5k': [1351, 1470], '10k': [2811, 3070],   halfMarathon: [6271, 6840],    marathon: [13201, 14400],   riegel: -0.09 },
      { '5k': [1471, 1600], '10k': [3071, 3325],   halfMarathon: [6841, 7410],    marathon: [14401, 15600],   riegel: -0.09 },
      { '5k': [1601, 1725], '10k': [3326, 3580],   halfMarathon: [7411, 7980],    marathon: [15601, 16800],   riegel: -0.10 },
      { '5k': [1726, 1860], '10k': [3581, 3840],   halfMarathon: [7981, 8550],    marathon: [16801, 18000],   riegel: -0.10 },
      { '5k': [1861, 7440], '10k': [3841, 15360],  halfMarathon: [8551, 34200],   marathon: [18001, 72000],   riegel: -0.10 },
    ],
  },

  '10k': {
    distanceRange: [9700, 10300],
    bands: [
      { '5k': [0, 870],     '10k': [0, 1790],     halfMarathon: [0, 3990],       marathon: [0, 8400],        riegel: -0.04 },
      { '5k': [871, 910],   '10k': [1791, 1890],   halfMarathon: [3991, 4210],    marathon: [8401, 8880],     riegel: -0.05 },
      { '5k': [911, 990],   '10k': [1891, 2050],   halfMarathon: [4211, 4560],    marathon: [8881, 9600],     riegel: -0.06 },
      { '5k': [991, 1110],  '10k': [2051, 2300],   halfMarathon: [4561, 5130],    marathon: [9601, 10800],    riegel: -0.07 },
      { '5k': [1111, 1230], '10k': [2301, 2560],   halfMarathon: [5131, 5700],    marathon: [10801, 12000],   riegel: -0.08 },
      { '5k': [1231, 1350], '10k': [2561, 2810],   halfMarathon: [5701, 6270],    marathon: [12001, 13200],   riegel: -0.08 },
      { '5k': [1351, 1470], '10k': [2811, 3070],   halfMarathon: [6271, 6840],    marathon: [13201, 14400],   riegel: -0.09 },
      { '5k': [1471, 1600], '10k': [3071, 3325],   halfMarathon: [6841, 7410],    marathon: [14401, 15600],   riegel: -0.09 },
      { '5k': [1601, 1725], '10k': [3326, 3580],   halfMarathon: [7411, 7980],    marathon: [15601, 16800],   riegel: -0.09 },
      { '5k': [1726, 1860], '10k': [3581, 3840],   halfMarathon: [7981, 8550],    marathon: [16801, 18000],   riegel: -0.10 },
      { '5k': [1861, 7440], '10k': [3841, 15360],  halfMarathon: [8551, 34200],   marathon: [18001, 72000],   riegel: -0.10 },
    ],
  },

  '5k': {
    distanceRange: [4850, 5150],
    bands: [
      { '5k': [0, 870],     '10k': [0, 1790],     halfMarathon: [0, 3990],       marathon: [0, 8400],        riegel: -0.04 },
      { '5k': [871, 910],   '10k': [1791, 1890],   halfMarathon: [3991, 4210],    marathon: [8401, 8880],     riegel: -0.05 },
      { '5k': [911, 990],   '10k': [1891, 2050],   halfMarathon: [4211, 4560],    marathon: [8881, 9600],     riegel: -0.06 },
      { '5k': [991, 1110],  '10k': [2051, 2300],   halfMarathon: [4561, 5130],    marathon: [9601, 10800],    riegel: -0.06 },
      { '5k': [1111, 1230], '10k': [2301, 2560],   halfMarathon: [5131, 5700],    marathon: [10801, 12000],   riegel: -0.07 },
      { '5k': [1231, 1350], '10k': [2561, 2810],   halfMarathon: [5701, 6270],    marathon: [12001, 13200],   riegel: -0.07 },
      { '5k': [1351, 1470], '10k': [2811, 3070],   halfMarathon: [6271, 6840],    marathon: [13201, 14400],   riegel: -0.08 },
      { '5k': [1471, 1600], '10k': [3071, 3325],   halfMarathon: [6841, 7410],    marathon: [14401, 15600],   riegel: -0.08 },
      { '5k': [1601, 1725], '10k': [3326, 3580],   halfMarathon: [7411, 7980],    marathon: [15601, 16800],   riegel: -0.09 },
      { '5k': [1726, 1860], '10k': [3581, 3840],   halfMarathon: [7981, 8550],    marathon: [16801, 18000],   riegel: -0.09 },
      { '5k': [1861, 7440], '10k': [3841, 15360],  halfMarathon: [8551, 34200],   marathon: [18001, 72000],   riegel: -0.09 },
    ],
  },
};

/**
 * Look up the Riegel fatigue exponent for the given target/known distance combination.
 * Returns null if no matching band exists (time out of range or invalid key).
 */
export function getRiegelExponent(
  targetDistance: DistKey,
  knownDistance: DistKey,
  knownTimeSeconds: number,
): number | null {
  const distData = riegelLookup[targetDistance];
  if (!distData) return null;
  const band = distData.bands.find((b) => {
    const [min, max] = b[knownDistance];
    return knownTimeSeconds >= min && knownTimeSeconds <= max;
  });
  return band ? band.riegel : null;
}

/**
 * Map a raw distance in meters to the nearest lookup key.
 * Returns null for ultras (> 45 km) which are not in the table.
 */
export function distMetersToKey(distanceMeters: number): DistKey | null {
  if (distanceMeters <  7_500) return '5k';
  if (distanceMeters < 15_000) return '10k';
  if (distanceMeters < 30_000) return 'halfMarathon';
  if (distanceMeters < 45_000) return 'marathon';
  return null;
}

/**
 * Map a StrategyRoom distance label to a lookup key.
 */
export function distLabelToKey(label: string): DistKey | null {
  switch (label) {
    case '5K':           return '5k';
    case '10K':          return '10k';
    case 'Half Marathon': return 'halfMarathon';
    case 'Marathon':     return 'marathon';
    default:             return null;
  }
}
