import type { PracticeCard, FilterCriteria, GoalStatus, FamiliarityLevel, TrainingRoute, RouteRunRecord } from './types';
import { GOAL_NEAR_DUE_DAYS } from './types';

const STORAGE_KEY = 'volunteer_guide_script_segments_v2';
const SELECTED_KEY = 'volunteer_guide_script_selected_ids_v2';
const LEGACY_STORAGE_KEY = 'volunteer_guide_practice_cards_v1';
const LEGACY_SELECTED_KEY = 'volunteer_guide_selected_ids_v1';
const ROUTES_KEY = 'volunteer_guide_training_routes_v1';
const ROUTE_RUNS_KEY = 'volunteer_guide_route_runs_v1';

function getStorage(): Storage {
  return sessionStorage;
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

export function loadCards(): PracticeCard[] {
  try {
    const raw = getStorage().getItem(STORAGE_KEY) || getStorage().getItem(LEGACY_STORAGE_KEY);
    if (!raw) return getDefaultCards();
    const parsed = JSON.parse(raw) as PracticeCard[];
    if (!Array.isArray(parsed)) return getDefaultCards();
    return parsed;
  } catch {
    return getDefaultCards();
  }
}

export function saveCards(cards: PracticeCard[]): void {
  getStorage().setItem(STORAGE_KEY, JSON.stringify(cards));
}

export function loadSelectedIds(): Set<string> {
  try {
    const raw = getStorage().getItem(SELECTED_KEY) || getStorage().getItem(LEGACY_SELECTED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

export function saveSelectedIds(ids: Set<string>): void {
  getStorage().setItem(SELECTED_KEY, JSON.stringify(Array.from(ids)));
}

function getDefaultCards(): PracticeCard[] {
  const now = Date.now();
  const DAY = 86400000;
  return [
    {
      id: generateId(),
      title: '序厅参观导览',
      zone: '序厅',
      durationMinutes: 5,
      keywords: ['欢迎词', '总体介绍', '参观路线'],
      errorPoints: ['不要遗漏安全须知', '参观方向说明要清晰'],
      alternatives: ['各位来宾上午好', '欢迎各位来到展览馆'],
      familiarity: 'practicing',
      reviewNote: '上周练习时漏讲了出口位置',
      isFavorite: true,
      isReviewed: false,
      createdAt: now - DAY * 5,
      updatedAt: now - DAY * 2,
      lastPracticedAt: now - DAY * 1,
      practiceCount: 3,
      practiceHistory: [now - DAY * 1, now - DAY * 2, now - DAY * 3],
      stageGoal: {
        targetFamiliarity: 'mastered',
        targetPracticeCount: 5,
        targetReviewDone: true,
        startDate: now - DAY * 5,
        dueDate: now + DAY * 2
      }
    },
    {
      id: generateId(),
      title: '第一展区历史沿革',
      zone: '历史展区',
      durationMinutes: 8,
      keywords: ['发展历程', '重要节点', '时代背景'],
      errorPoints: ['年代数字容易记错', '人物关系要理清'],
      alternatives: ['这段历史可以追溯到', '让我们把目光投向'],
      familiarity: 'learning',
      reviewNote: '',
      isFavorite: false,
      isReviewed: false,
      createdAt: now - DAY * 4,
      updatedAt: now - DAY * 3,
      lastPracticedAt: now - DAY * 3,
      practiceCount: 2,
      practiceHistory: [now - DAY * 3, now - DAY * 4],
      stageGoal: {
        targetFamiliarity: 'practicing',
        targetPracticeCount: 4,
        targetReviewDone: false,
        startDate: now - DAY * 4,
        dueDate: now + DAY * 7
      }
    },
    {
      id: generateId(),
      title: '核心展品讲解',
      zone: '主展区',
      durationMinutes: 12,
      keywords: ['镇馆之宝', '工艺特点', '历史价值'],
      errorPoints: [],
      alternatives: ['这件展品的独特之处在于', '请大家仔细观察'],
      familiarity: 'new',
      reviewNote: '',
      isFavorite: true,
      isReviewed: false,
      createdAt: now - DAY * 2,
      updatedAt: now - DAY * 2,
      practiceCount: 0,
      practiceHistory: []
    },
    {
      id: generateId(),
      title: '互动体验区说明',
      zone: '互动区',
      durationMinutes: 4,
      keywords: ['操作指引', '注意事项', '体验内容'],
      errorPoints: ['设备启动顺序', '紧急停止位置'],
      alternatives: [],
      familiarity: 'mastered',
      reviewNote: '已能流畅引导游客',
      isFavorite: false,
      isReviewed: true,
      createdAt: now - DAY * 10,
      updatedAt: now - DAY * 1,
      lastPracticedAt: now - DAY * 5,
      practiceCount: 8,
      practiceHistory: [
        now - DAY * 5,
        now - DAY * 6,
        now - DAY * 7,
        now - DAY * 10,
        now - DAY * 12,
        now - DAY * 15,
        now - DAY * 18,
        now - DAY * 20
      ],
      stageGoal: {
        targetFamiliarity: 'maintain',
        targetPracticeCount: 2,
        targetReviewDone: false,
        startDate: now - DAY * 3,
        dueDate: now - DAY * 1,
        completedAt: now - DAY * 1
      }
    },
    {
      id: generateId(),
      title: '结尾致辞与引导',
      zone: '尾厅',
      durationMinutes: 3,
      keywords: ['感谢光临', '反馈收集', '参观结束'],
      errorPoints: [],
      alternatives: ['感谢各位的耐心聆听', '希望您有所收获'],
      familiarity: 'mastered',
      reviewNote: '',
      isFavorite: false,
      isReviewed: true,
      createdAt: now - DAY * 15,
      updatedAt: now - DAY * 10,
      lastPracticedAt: now - DAY * 8,
      practiceCount: 12,
      practiceHistory: [
        now - DAY * 8,
        now - DAY * 10,
        now - DAY * 12,
        now - DAY * 14,
        now - DAY * 16,
        now - DAY * 18,
        now - DAY * 20,
        now - DAY * 22,
        now - DAY * 24,
        now - DAY * 26,
        now - DAY * 28,
        now - DAY * 30
      ]
    }
  ];
}

export function createEmptyCard(): PracticeCard {
  const now = Date.now();
  return {
    id: generateId(),
    title: '',
    zone: '',
    durationMinutes: 5,
    keywords: [],
    errorPoints: [],
    alternatives: [],
    familiarity: 'new',
    reviewNote: '',
    isFavorite: false,
    isReviewed: false,
    createdAt: now,
    updatedAt: now,
    practiceCount: 0,
    practiceHistory: []
  };
}

export function cloneCard(source: PracticeCard): PracticeCard {
  const now = Date.now();
  return {
    ...source,
    id: generateId(),
    title: source.title + '（副本）',
    createdAt: now,
    updatedAt: now,
    practiceCount: 0,
    lastPracticedAt: undefined,
    practiceHistory: [],
    isReviewed: false,
    reviewNote: '',
    stageGoal: undefined
  };
}

export function getUniqueZones(cards: PracticeCard[]): string[] {
  const set = new Set<string>();
  cards.forEach((c) => c.zone && set.add(c.zone));
  return Array.from(set).sort();
}

const FAMILIARITY_ORDER: FamiliarityLevel[] = ['new', 'learning', 'practicing', 'mastered'];

function getGoalStatusForFilter(card: PracticeCard): GoalStatus {
  if (!card.stageGoal) return 'none';
  const goal = card.stageGoal;
  const now = Date.now();
  const DAY = 86400000;

  const practicesInPeriod = card.practiceHistory.filter((ts) => ts >= goal.startDate).length;
  const practiceProgress = goal.targetPracticeCount > 0
    ? Math.min(1, practicesInPeriod / goal.targetPracticeCount)
    : 1;

  let familiarityProgress = 1;
  if (goal.targetFamiliarity !== 'maintain') {
    const currentIdx = FAMILIARITY_ORDER.indexOf(card.familiarity);
    const targetIdx = FAMILIARITY_ORDER.indexOf(goal.targetFamiliarity);
    const startIdx = 0;
    if (targetIdx > startIdx) {
      const effectiveCurrent = Math.min(currentIdx, targetIdx);
      familiarityProgress = (effectiveCurrent - startIdx) / (targetIdx - startIdx);
    } else {
      familiarityProgress = currentIdx >= targetIdx ? 1 : 0;
    }
  }

  const reviewProgress = goal.targetReviewDone ? (card.isReviewed ? 1 : 0) : 1;
  const overallProgress = (practiceProgress + familiarityProgress + reviewProgress) / 3;
  const daysRemaining = Math.ceil((goal.dueDate - now) / DAY);

  if (goal.completedAt) return 'achieved';
  if (overallProgress >= 1) return 'achieved';
  if (daysRemaining < 0) return 'overdue';
  if (daysRemaining <= GOAL_NEAR_DUE_DAYS) return 'near_due';
  return 'in_progress';
}

export function filterCards(cards: PracticeCard[], criteria: FilterCriteria): PracticeCard[] {
  return cards.filter((card) => {
    if (criteria.zones.length > 0 && !criteria.zones.includes(card.zone)) return false;
    if (criteria.familiarity.length > 0 && !criteria.familiarity.includes(card.familiarity)) return false;
    if (criteria.minDuration !== null && card.durationMinutes < criteria.minDuration) return false;
    if (criteria.maxDuration !== null && card.durationMinutes > criteria.maxDuration) return false;
    if (criteria.hasErrorPoints === 'yes' && card.errorPoints.length === 0) return false;
    if (criteria.hasErrorPoints === 'no' && card.errorPoints.length > 0) return false;
    if (criteria.isReviewed === 'yes' && !card.isReviewed) return false;
    if (criteria.isReviewed === 'no' && card.isReviewed) return false;
    if (criteria.goalStatus.length > 0) {
      const status = getGoalStatusForFilter(card);
      if (!criteria.goalStatus.includes(status)) return false;
    }
    if (criteria.searchText) {
      const q = criteria.searchText.toLowerCase();
      const searchable = [
        card.title,
        card.zone,
        card.reviewNote,
        ...card.keywords,
        ...card.errorPoints,
        ...card.alternatives
      ].join(' ').toLowerCase();
      if (!searchable.includes(q)) return false;
    }
    return true;
  });
}

export function createEmptyRoute(): TrainingRoute {
  const now = Date.now();
  const defaultTarget = new Date();
  defaultTarget.setDate(defaultTarget.getDate() + 14);
  return {
    id: generateId(),
    name: '',
    description: '',
    stepIds: [],
    targetDate: defaultTarget.getTime(),
    createdAt: now,
    updatedAt: now
  };
}

export function cloneRoute(source: TrainingRoute): TrainingRoute {
  const now = Date.now();
  return {
    ...source,
    id: generateId(),
    name: source.name + '（副本）',
    stepIds: [...source.stepIds],
    createdAt: now,
    updatedAt: now,
    archivedAt: undefined,
    lastRunAt: undefined
  };
}

export function loadRoutes(): TrainingRoute[] {
  try {
    const raw = getStorage().getItem(ROUTES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrainingRoute[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveRoutes(routes: TrainingRoute[]): void {
  getStorage().setItem(ROUTES_KEY, JSON.stringify(routes));
}

export function loadRouteRuns(): RouteRunRecord[] {
  try {
    const raw = getStorage().getItem(ROUTE_RUNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RouteRunRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveRouteRuns(runs: RouteRunRecord[]): void {
  getStorage().setItem(ROUTE_RUNS_KEY, JSON.stringify(runs));
}
