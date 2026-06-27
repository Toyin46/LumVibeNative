// ═══════════════════════════════════════════════════════════
// coachEngine.ts — Real-time Coach Orchestrator
// src/components/coach/coachEngine.ts
// FIX: Line 105 — ignored field type corrected
// ═══════════════════════════════════════════════════════════

import type { AICoachState, ContentAdvice } from '../../utils/types';
import type { AICoachSession } from '../../hooks/useAICoach';

export interface SessionReport {
  pitchScore:   number;
  vibe:         string;
  durationSecs: number;
  takes:        number;
}

const DEMONSTRATION_LINES = [
  'Listen closely — match this pitch.',
  'Here is the target note. Mirror it exactly.',
  'Take a breath and aim for this sound.',
  'Hear that resonance? Now you try.',
  'This is where the note lives. Find it.',
];

const SESSION_START_LINES = [
  "Warm up and find your vocal center. Let's go.",
  "Give me your best — I'm listening to every note.",
  'Relax your shoulders, deep breath, and begin.',
  "Show me what you've been working on.",
  "Ready? Let's make something world-class.",
];

const CELEBRATING_LINES = [
  'That pitch is locked in. Keep that breath support.',
  "Perfect. Don't change a thing.",
  'That note was exactly where it needed to be.',
];

const ENCOURAGING_LINES = [
  'Very close — lift the pitch slightly to lock it in.',
  "You're almost there. Trust your ear.",
  'Good attempt. One more time with more support.',
];

const STRICT_LINES = [
  (note: string, target: string) => `You sang ${note} — target is ${target}. Listen again.`,
  (note: string, target: string) => `That was ${note}. I need ${target}. Focus.`,
  (note: string, target: string) => `${note} is not ${target}. Hear the difference.`,
];

const CORRECTING_LINES = [
  "You're drifting. Reset your breath and come back to center.",
  'Stop and listen to the reference before the next take.',
  'Pitch is unstable. Take a breath — control comes first.',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function initialCoachState(): AICoachState {
  return {
    isActive:        false,
    currentNote:     '—',
    targetNote:      'A4',
    pitchAccuracy:   0,
    feedback:        'Ready when you are. Take a deep breath and begin.',
    coachTip:        '',
    sessionScore:    50,
    recordingTakes:  0,
    lastCoachTime:   0,
    vuLevel:         0,
    frequency:       0,
    mood:            'idle',
    correctionCount: 0,
    // WHY: ignored must be boolean — was causing "true not assignable to false" error
    ignored:         false,
    contentAdvice:   null,
  };
}

export function shouldCoachPause(accuracyHistory: number[]): boolean {
  if (!accuracyHistory || accuracyHistory.length < 3) return false;
  const len = accuracyHistory.length;
  return (
    accuracyHistory[len - 1] < 30 &&
    accuracyHistory[len - 2] < 30 &&
    accuracyHistory[len - 3] < 30
  );
}

export function getDemonstrationLine(): string {
  return pick(DEMONSTRATION_LINES);
}

export function getSessionStartLine(): string {
  return pick(SESSION_START_LINES);
}

export function runCoachEngine(
  prev:       AICoachState,
  accuracy:   number,
  frequency:  number,
  note:       string,
  targetNote: string,
  nowMs:      number,
): AICoachState {
  const sinceLastCoach = nowMs - prev.lastCoachTime;
  if (sinceLastCoach < 1500) {
    return {
      ...prev,
      currentNote:   note,
      frequency,
      pitchAccuracy: accuracy,
    };
  }

  if (prev.ignored) {
    return { ...prev, currentNote: note, frequency, pitchAccuracy: accuracy };
  }

  let mood:            AICoachState['mood'] = prev.mood;
  let feedback        = prev.feedback;
  let coachTip        = prev.coachTip;
  let correctionCount = prev.correctionCount;
  // WHY: explicitly typed as boolean to prevent assignability error
  let ignored:        boolean               = prev.ignored;
  let sessionScore    = prev.sessionScore;

  if (accuracy >= 85) {
    mood            = 'celebrating';
    feedback        = pick(CELEBRATING_LINES);
    coachTip        = '🔥 Perfect pitch — maintain this breath support.';
    correctionCount = 0;
    sessionScore    = Math.min(100, sessionScore + 3);
  } else if (accuracy >= 65) {
    mood     = 'encouraging';
    feedback = pick(ENCOURAGING_LINES);
    coachTip = `📍 You're on ${note} — target is ${targetNote}.`;
  } else if (accuracy >= 35) {
    mood            = 'strict';
    correctionCount += 1;
    feedback        = pick(STRICT_LINES)(note, targetNote);
    coachTip        = `❗ ${note} → ${targetNote} (${correctionCount}/3)`;
    sessionScore    = Math.max(0, sessionScore - 2);

    if (correctionCount >= 4) {
      mood     = 'idle';
      feedback = 'I have said it three times. Your call now.';
      coachTip = '👋 Coach backed off. Resume when ready.';
      // WHY: assign literal boolean true — was causing ts(2322) type error
      ignored  = true;
    }
  } else {
    mood            = 'correcting';
    correctionCount += 1;
    feedback        = pick(CORRECTING_LINES);
    coachTip        = '⚠️ Pitch unstable — stop and listen before next take.';
    sessionScore    = Math.max(0, sessionScore - 3);
  }

  return {
    ...prev,
    currentNote:     note,
    targetNote,
    pitchAccuracy:   accuracy,
    frequency,
    mood,
    feedback,
    coachTip,
    correctionCount,
    ignored,
    sessionScore,
    lastCoachTime:   nowMs,
  };
}

export function buildSessionReport(
  state: AICoachState,
  vibe:  string,
  takes: number,
): SessionReport {
  return {
    pitchScore:   state.sessionScore,
    vibe,
    durationSecs: state.lastCoachTime > 0
      ? Math.floor(state.lastCoachTime / 1000)
      : 0,
    takes,
  };
}

export function applyAICoachResult(
  prev:    AICoachState,
  session: AICoachSession,
): AICoachState {
  const moodMap: Record<AICoachSession['moodRating'], AICoachState['mood']> = {
    celebrating: 'celebrating',
    encouraging: 'encouraging',
    strict:      'strict',
    correcting:  'correcting',
  };

  const contentAdvice: ContentAdvice = {
    platforms:        session.platformAdvice,
    contentTypes:     [session.nextExercise],
    postingTimes:     ['7pm–9pm your local time on weekdays'],
    captionTips:      [session.contentStrategy],
    hashtagSets:      ['#LumVibe #NewMusic #Creator'],
    genreStrengths:   [],
    improvementAreas: [session.technicalNote],
  };

  return {
    ...prev,
    mood:            moodMap[session.moodRating] ?? 'encouraging',
    feedback:        `${session.immediateCoaching} ${session.encouragement}`.trim(),
    coachTip:        session.technicalNote,
    contentAdvice,
    ignored:         false,
    correctionCount: 0,
  };
}

// WHY: generateContentAdvice kept for backward compatibility
// MovieStudioScreen imports this — now returns safe defaults
export function generateContentAdvice(
  vibe:         string,
  sessionScore: number,
  rangeResult:  { rangeLabel: string },
  takes:        number,
): ContentAdvice {
  return {
    platforms:        ['TikTok', 'Instagram Reels', 'YouTube Shorts'],
    contentTypes:     ['cover song', 'studio session', 'behind the scenes'],
    postingTimes:     ['7pm–9pm WAT weekdays', 'Saturday noon WAT'],
    captionTips:      ['End caption with a question', 'Tag a Nigerian music blog'],
    hashtagSets:      ['#LumVibe #NaijaMusic #AfrobeatsTikTok'],
    genreStrengths:   sessionScore > 70 ? ['Strong pitch control'] : [],
    improvementAreas: sessionScore < 60 ? ['Pitch consistency'] : [],
  };
} 