/**
 * Glicko-2 (M6 6.2, spec 9.3: tracked per bracket and per format), after Glickman, "Example of the
 * Glicko-2 system" (2013). Ratings are on the Glicko scale (1500 / 350); one call updates a player
 * over one rating period from the games played in it. Pure; the constants are PROVISIONAL.
 */
export interface Rating {
  rating: number;
  rd: number;
  volatility: number;
}

export interface GameResult {
  opponent: Rating;
  /** 1 win, 0.5 draw, 0 loss. */
  score: 0 | 0.5 | 1;
}

export const DEFAULT_RATING: Rating = { rating: 1500, rd: 350, volatility: 0.06 };
/** System constant τ: how much volatility may change (Glickman suggests 0.3–1.2). */
export const TAU = 0.5;
const SCALE = 173.7178;
const EPSILON = 1e-6;
/** RD never falls below this, so ratings keep moving (a common Glicko practice). */
export const MIN_RD = 30;

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const e = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** The player's rating after one period with `games` (none: only RD grows). */
export function update(player: Rating, games: readonly GameResult[], tau = TAU): Rating {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.volatility;
  if (games.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: player.rating, rd: Math.min(350, phiStar * SCALE), volatility: sigma };
  }
  let vInv = 0;
  let deltaSum = 0;
  for (const { opponent, score } of games) {
    const muJ = (opponent.rating - 1500) / SCALE;
    const phiJ = opponent.rd / SCALE;
    const E = e(mu, muJ, phiJ);
    const gj = g(phiJ);
    vInv += gj * gj * E * (1 - E);
    deltaSum += gj * (score - E);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;
  // Volatility by the Illinois algorithm (step 5 of the paper).
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (
      (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) -
      (x - a) / (tau * tau)
    );
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > EPSILON; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else fA /= 2;
    B = C;
    fB = fC;
  }
  const sigmaNew = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + sigmaNew * sigmaNew);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * deltaSum;
  return {
    rating: muNew * SCALE + 1500,
    rd: Math.max(MIN_RD, phiNew * SCALE),
    volatility: sigmaNew,
  };
}

/** Ranked brackets use unlocked item slots, never consumed slots (9.3): 1–2, 3–4, 5–6. */
export function bracketForSlots(unlockedSlots: number): '1-2' | '3-4' | '5-6' {
  return unlockedSlots <= 2 ? '1-2' : unlockedSlots <= 4 ? '3-4' : '5-6';
}
