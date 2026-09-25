/**
 * Chess Academy lessons (10.3, R-WORLD-003): puzzle lessons for piece movement, check and checkmate
 * (skippable by veterans), then battle lessons that teach one ability at a time and then the
 * elements (never skippable). Written for players who barely know chess (pillar 5).
 *
 * Puzzle goals by topic (checked with the engine by `validateWorld`): `movement` = capture the enemy
 * piece, `check` = give check, `checkmate` = deliver mate. `accept` lists every legal move that
 * reaches the goal, so no correct answer is ever marked wrong.
 *
 * Battle lessons are real server battles with fixed loaner loadouts at the listed levels (legal per
 * R-LOAD-004), First Blood, against a Wild-strength sparring army. The player's loadout carries
 * exactly one ability; ability lessons pit the same element on both sides so nothing is silenced,
 * and the element lesson gives the player the advantaged element.
 */
import type { LessonDef } from './types.ts';

export const LESSONS: readonly LessonDef[] = [
  {
    id: 'moves_basics',
    title: 'How the pieces move',
    kind: 'puzzles',
    topic: 'movement',
    skippable: true,
    intro: [
      'Welcome! Every battle here is played on a chessboard, and your creatures move like chess pieces. Let us learn how each one moves.',
      'In each puzzle, make one move that captures the enemy piece. Tap your piece, then tap where it should go. A wrong move is fine: you will get a hint.',
      'Already know chess? You may skip this lesson.',
    ],
    puzzles: [
      {
        fen: '7k/3n4/8/8/8/8/3R4/7K w - - 0 1',
        prompt:
          'The rook moves in straight lines (up, down, left or right) as far as the way is clear. Capture the black knight with your rook.',
        accept: ['d2d7'],
        hint: 'Slide the rook straight up its column until it reaches the knight.',
      },
      {
        fen: '7k/8/8/6r1/8/8/8/K1B5 w - - 0 1',
        prompt:
          'The bishop moves diagonally, as far as the way is clear. Capture the black rook with your bishop.',
        accept: ['c1g5'],
        hint: 'Follow the diagonal from your bishop up and to the right.',
      },
      {
        fen: '7k/8/5b2/8/4N3/8/8/7K w - - 0 1',
        prompt:
          'The knight jumps in an L shape: two squares one way, then one square to the side. It is the only piece that can jump over others. Capture the black bishop.',
        accept: ['e4f6'],
        hint: 'Two squares up, then one square to the right.',
      },
      {
        fen: 'k7/8/8/7n/8/8/8/K2Q4 w - - 0 1',
        prompt:
          'The queen is the strongest piece: she moves like a rook and a bishop together. Capture the black knight with your queen.',
        accept: ['d1h5'],
        hint: 'Look along the diagonal from your queen towards the top right.',
      },
      {
        fen: '7k/8/8/4p3/4K3/8/8/8 w - - 0 1',
        prompt:
          'The king moves one square in any direction. Keep him safe, but he can capture too! Capture the black pawn with your king.',
        accept: ['e4e5'],
        hint: 'The pawn is standing right in front of your king.',
      },
      {
        fen: '7k/8/8/3np3/4P3/8/8/K7 w - - 0 1',
        prompt:
          'Pawns walk straight forward one square, but they capture one square diagonally forward. Capture the black knight with your pawn.',
        accept: ['e4d5'],
        hint: 'Your pawn cannot capture the pawn straight ahead of it. Look diagonally forward.',
      },
    ],
    reward: { xp: 30 },
  },
  {
    id: 'check_basics',
    title: 'Check!',
    kind: 'puzzles',
    topic: 'check',
    skippable: true,
    intro: [
      'When one of your pieces attacks the enemy king, that king is in check. The player in check must get out of it with their next move.',
      'In each puzzle, make a move that puts the black king in check. Sometimes more than one move works.',
    ],
    puzzles: [
      {
        fen: '4k3/8/8/8/8/8/R7/6K1 w - - 0 1',
        prompt: 'Put the black king in check with your rook.',
        accept: ['a2a8', 'a2e2'],
        hint: 'A rook attacks along its whole row and column. Line it up with the king.',
      },
      {
        fen: '4k3/8/8/8/4N3/8/8/K7 w - - 0 1',
        prompt: 'Knights give check by jumping. Put the black king in check with your knight.',
        accept: ['e4d6', 'e4f6'],
        hint: 'Find a square from which your knight could jump onto the king next turn.',
      },
      {
        fen: '4k3/8/8/8/8/8/8/K4B2 w - - 0 1',
        prompt: 'Put the black king in check with your bishop.',
        accept: ['f1b5'],
        hint: 'Bishops attack along diagonals. Which diagonal leads to the king?',
      },
    ],
    reward: { xp: 30 },
  },
  {
    id: 'checkmate_basics',
    title: 'Checkmate',
    kind: 'puzzles',
    topic: 'checkmate',
    skippable: true,
    intro: [
      'Checkmate is a check the king cannot escape: it cannot step to safety, the attacker cannot be captured, and nothing can block the attack. Checkmate wins the battle.',
      'In each puzzle, find a move that delivers checkmate.',
    ],
    puzzles: [
      {
        fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
        prompt: 'The black king is stuck behind its own pawns. Checkmate it with your rook.',
        accept: ['a1a8'],
        hint: "Move the rook onto the king's row. The pawns block every escape.",
      },
      {
        fen: '7k/Q7/6K1/8/8/8/8/8 w - - 0 1',
        prompt:
          'Your king guards the two squares in front of the black king. Checkmate it with your queen.',
        accept: ['a7a8', 'a7b8', 'a7g7', 'a7h7'],
        hint: 'Check the king along its own row, or from right beside it where your king protects the queen.',
      },
      {
        fen: '4k3/R7/8/8/8/8/8/2K4R w - - 0 1',
        prompt:
          'One rook already guards the row in front of the black king. Checkmate with the other rook.',
        accept: ['h1h8'],
        hint: "Send the rook on the right all the way up to the king's row.",
      },
      {
        fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
        prompt:
          'A famous early trap: your queen and your bishop both aim at the pawn beside the black king. Capture it with the queen for checkmate!',
        accept: ['h5f7'],
        hint: 'Take the pawn on f7 with your queen. Your bishop protects her there.',
      },
    ],
    reward: { xp: 40 },
  },
  {
    id: 'ability_hit_and_run',
    title: 'Ability: Hit and Run',
    kind: 'battle',
    topic: 'ability',
    skippable: false,
    intro: [
      'Abilities are tricks your pieces carry into battle. Each one fires at a set moment of a capture, the same way every time: no dice, no luck.',
      'Hit and Run fires right after your piece captures: the piece hops back to the square it came from, out of harm’s way.',
      'This is a First Blood battle: the first side to capture any piece that is not a pawn wins. Every piece in your army carries Hit and Run. Capture something and watch it step back!',
    ],
    format: 'first_blood',
    player: { level: 1, loadout: { elements: ['tide'], items: [], sets: [['hit_and_run']] } },
    npc: {
      name: 'Academy Sparring Army',
      tier: 'wild',
      level: 1,
      loadout: { elements: ['tide'], items: [], sets: [[]] },
    },
    reward: { xp: 50 },
  },
  {
    id: 'ability_scout',
    title: 'Ability: Scout',
    kind: 'battle',
    topic: 'ability',
    skippable: false,
    intro: [
      'Your opponent’s abilities stay hidden until they show themselves. Scout lets you peek.',
      'Scout fires as your piece captures, before the victim’s own abilities go off, and reveals every ability the victim carries.',
      'The sparring army carries one hidden ability. Capture a piece and find out what it is. Careful: their ability may tell them about yours, too!',
    ],
    format: 'first_blood',
    player: { level: 1, loadout: { elements: ['tide'], items: [], sets: [['scout']] } },
    npc: {
      name: 'Academy Sparring Army',
      tier: 'wild',
      level: 1,
      loadout: { elements: ['tide'], items: [], sets: [['last_word']] },
    },
    reward: { xp: 50 },
  },
  {
    id: 'ability_poisoned_meat',
    title: 'Ability: Poisoned Meat',
    kind: 'battle',
    topic: 'ability',
    skippable: false,
    intro: [
      'Some abilities fire when your piece is captured. Poisoned Meat is one of them: the piece that captures a Poisoned Meat piece is removed from the board too (kings are immune to that).',
      'That makes your pieces costly to take. Let the sparring army capture one and watch the trap spring. A piece removed by an ability counts for First Blood as well!',
    ],
    format: 'first_blood',
    player: { level: 2, loadout: { elements: ['grove'], items: [], sets: [['poisoned_meat']] } },
    npc: {
      name: 'Academy Sparring Army',
      tier: 'wild',
      level: 1,
      loadout: { elements: ['grove'], items: [], sets: [[]] },
    },
    reward: { xp: 50, cards: [{ id: 'poisoned_meat', qty: 1 }] },
  },
  {
    id: 'elements_triangle',
    title: 'Elements: Ember, Tide and Grove',
    kind: 'battle',
    topic: 'element',
    skippable: false,
    intro: [
      'Every army has an element. Ember beats Grove, Grove beats Tide, and Tide beats Ember.',
      'When two pieces meet in a capture and one element beats the other, the weaker piece’s abilities stay silent for that capture.',
      'Each element also has a trait that is always on. Tide pieces can move through their own pieces (Flow). When an Ember piece captures and then moves on, the square it leaves burns for three turns (Hot Foot). Grove pieces get double charges on abilities that have charges (Overabundance).',
      'You lead Tide against an Ember army. Your Hit and Run works when your pieces capture theirs, but their Backdraft stays silent every time a Tide piece takes an Ember piece. Pick your element wisely!',
    ],
    format: 'first_blood',
    player: { level: 1, loadout: { elements: ['tide'], items: [], sets: [['hit_and_run']] } },
    npc: {
      name: 'Ember Sparring Army',
      tier: 'wild',
      level: 4,
      loadout: { elements: ['ember'], items: [], sets: [['backdraft']] },
    },
    reward: { xp: 60 },
  },
];
