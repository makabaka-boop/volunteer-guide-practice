export type FamiliarityLevel = 'new' | 'learning' | 'practicing' | 'mastered';

export type GoalStatus = 'none' | 'achieved' | 'in_progress' | 'near_due' | 'overdue';

export type GoalFamiliarityTarget = FamiliarityLevel | 'maintain';

export interface StageGoal {
  targetFamiliarity: GoalFamiliarityTarget;
  targetPracticeCount: number;
  targetReviewDone: boolean;
  dueDate: number;
  startDate: number;
  completedAt?: number;
}

export interface GoalProgress {
  practiceProgress: number;
  familiarityProgress: number;
  reviewProgress: number;
  overallProgress: number;
  daysRemaining: number;
  status: GoalStatus;
}

export interface PracticeCard {
  id: string;
  title: string;
  zone: string;
  durationMinutes: number;
  keywords: string[];
  errorPoints: string[];
  alternatives: string[];
  familiarity: FamiliarityLevel;
  reviewNote: string;
  isFavorite: boolean;
  isReviewed: boolean;
  createdAt: number;
  updatedAt: number;
  lastPracticedAt?: number;
  practiceCount: number;
  practiceHistory: number[];
  stageGoal?: StageGoal;
}

export interface FilterCriteria {
  zones: string[];
  familiarity: FamiliarityLevel[];
  minDuration: number | null;
  maxDuration: number | null;
  hasErrorPoints: 'all' | 'yes' | 'no';
  isReviewed: 'all' | 'yes' | 'no';
  goalStatus: GoalStatus[];
  searchText: string;
}

export type CheckSeverity = 'warning' | 'error' | 'info';

export interface CheckResult {
  id: string;
  severity: CheckSeverity;
  message: string;
  cardId?: string;
  cardTitle?: string;
  rule: CheckRule;
}

export type CheckRule =
  | 'DURATION_TOO_LONG'
  | 'DUPLICATE_ZONE_SEGMENT'
  | 'EMPTY_ERROR_POINTS_MASTERED'
  | 'MISSING_ALTERNATIVES'
  | 'HIGH_RECENT_PRACTICE'
  | 'GOAL_NEAR_DUE'
  | 'GOAL_OVERDUE'
  | 'GOAL_ACHIEVED_NOT_MARKED';

export interface DailyPracticeItem {
  card: PracticeCard;
  priority: number;
  reason: string;
}

export interface DailyPracticePlan {
  items: DailyPracticeItem[];
  totalDurationMinutes: number;
  needReviewCount: number;
  needPracticeCount: number;
}

export const FAMILIARITY_LABELS: Record<FamiliarityLevel, string> = {
  new: '未学习',
  learning: '学习中',
  practicing: '练习中',
  mastered: '已掌握'
};

export const FAMILIARITY_COLORS: Record<FamiliarityLevel, string> = {
  new: '#94a3b8',
  learning: '#3b82f6',
  practicing: '#f59e0b',
  mastered: '#10b981'
};

export const MAX_RECOMMENDED_DURATION = 15;
export const HIGH_PRACTICE_THRESHOLD_DAYS = 3;
export const HIGH_PRACTICE_COUNT = 5;

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  none: '未设置目标',
  achieved: '目标已达成',
  in_progress: '进行中',
  near_due: '临期提醒',
  overdue: '已逾期'
};

export const GOAL_STATUS_COLORS: Record<GoalStatus, string> = {
  none: '#94a3b8',
  achieved: '#10b981',
  in_progress: '#3b82f6',
  near_due: '#f59e0b',
  overdue: '#ef4444'
};

export const GOAL_FAMILIARITY_TARGET_LABELS: Record<GoalFamiliarityTarget, string> = {
  new: '未学习',
  learning: '学习中',
  practicing: '练习中',
  mastered: '已掌握',
  maintain: '保持现状'
};

export const GOAL_NEAR_DUE_DAYS = 3;

const FAMILIARITY_ORDER: FamiliarityLevel[] = ['new', 'learning', 'practicing', 'mastered'];
export function getFamiliarityIndex(level: FamiliarityLevel): number {
  return FAMILIARITY_ORDER.indexOf(level);
}
