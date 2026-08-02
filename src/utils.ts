import type {
  PracticeCard,
  CheckResult,
  DailyPracticePlan,
  DailyPracticeItem,
  GoalProgress,
  GoalStatus,
  TrainingRoute,
  RouteRunRecord,
  RouteStepRef,
  RouteGoalSummary,
  RouteSummary
} from './types';
import {
  MAX_RECOMMENDED_DURATION,
  HIGH_PRACTICE_THRESHOLD_DAYS,
  HIGH_PRACTICE_COUNT,
  GOAL_NEAR_DUE_DAYS,
  GOAL_STATUS_LABELS,
  getFamiliarityIndex
} from './types';
import { generateId, createEmptyRoute } from './storage';

export function formatDate(ts: number | undefined): string {
  if (!ts) return '从未';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDateTime(ts: number | undefined): string {
  if (!ts) return '从未';
  const d = new Date(ts);
  return `${formatDate(ts)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function daysBetween(a: number, b: number): number {
  const ms = Math.abs(a - b);
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

export function countRecentPractices(history: number[], days: number): number {
  if (!history || history.length === 0) return 0;
  const cutoff = Date.now() - days * 86400000;
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] >= cutoff) count++;
    else break;
  }
  return count;
}

export function runChecks(cards: PracticeCard[]): CheckResult[] {
  const results: CheckResult[] = [];

  for (const card of cards) {
    if (card.durationMinutes > MAX_RECOMMENDED_DURATION) {
      results.push({
        id: generateId(),
        severity: 'warning',
        rule: 'DURATION_TOO_LONG',
        message: `条目「${card.title}」建议时长 ${card.durationMinutes} 分钟，超过推荐上限 ${MAX_RECOMMENDED_DURATION} 分钟，建议拆成更短的讲解段落`,
        cardId: card.id,
        cardTitle: card.title
      });
    }

    if (card.familiarity === 'mastered' && card.errorPoints.length === 0) {
      results.push({
        id: generateId(),
        severity: 'info',
        rule: 'EMPTY_ERROR_POINTS_MASTERED',
        message: `条目「${card.title}」标记为已掌握但易错点为空，建议确认是否真的无易错项`,
        cardId: card.id,
        cardTitle: card.title
      });
    }

    if (card.alternatives.length === 0 && card.familiarity !== 'mastered') {
      results.push({
        id: generateId(),
        severity: 'warning',
        rule: 'MISSING_ALTERNATIVES',
        message: `条目「${card.title}」缺少替代表达，建议补充以备现场节奏变化`,
        cardId: card.id,
        cardTitle: card.title
      });
    }

    if (card.lastPracticedAt) {
      const recentCount = countRecentPractices(card.practiceHistory, HIGH_PRACTICE_THRESHOLD_DAYS);
      if (recentCount >= HIGH_PRACTICE_COUNT) {
        results.push({
          id: generateId(),
          severity: 'info',
          rule: 'HIGH_RECENT_PRACTICE',
          message: `条目「${card.title}」近 ${HIGH_PRACTICE_THRESHOLD_DAYS} 天内试讲 ${recentCount} 次，强度较高，注意间隔复盘`,
          cardId: card.id,
          cardTitle: card.title
        });
      }
    }

    if (card.stageGoal && !card.stageGoal.completedAt) {
      const progress = calculateGoalProgress(card);
      if (progress) {
        if (progress.status === 'overdue') {
          results.push({
            id: generateId(),
            severity: 'error',
            rule: 'GOAL_OVERDUE',
            message: `条目「${card.title}」的阶段目标已逾期 ${Math.abs(progress.daysRemaining)} 天，请尽快完成`,
            cardId: card.id,
            cardTitle: card.title
          });
        } else if (progress.status === 'near_due') {
          results.push({
            id: generateId(),
            severity: 'warning',
            rule: 'GOAL_NEAR_DUE',
            message: `条目「${card.title}」的阶段目标将在 ${progress.daysRemaining} 天后截止，当前进度 ${Math.round(progress.overallProgress * 100)}%`,
            cardId: card.id,
            cardTitle: card.title
          });
        }

        if (progress.status === 'achieved' && !card.stageGoal.completedAt) {
          results.push({
            id: generateId(),
            severity: 'info',
            rule: 'GOAL_ACHIEVED_NOT_MARKED',
            message: `条目「${card.title}」已达成阶段目标，可手动确认完成`,
            cardId: card.id,
            cardTitle: card.title
          });
        }
      }
    }
  }

  const zoneMap = new Map<string, Map<string, PracticeCard[]>>();
  for (const card of cards) {
    if (!card.zone || !card.title) continue;
    if (!zoneMap.has(card.zone)) zoneMap.set(card.zone, new Map());
    const titleMap = zoneMap.get(card.zone)!;
    const key = card.title.trim().toLowerCase();
    if (!titleMap.has(key)) titleMap.set(key, []);
    titleMap.get(key)!.push(card);
  }

  for (const [zone, titleMap] of zoneMap.entries()) {
    for (const [, group] of titleMap.entries()) {
      if (group.length > 1) {
        results.push({
          id: generateId(),
          severity: 'error',
          rule: 'DUPLICATE_ZONE_SEGMENT',
          message: `展区「${zone}」中存在 ${group.length} 个同名条目「${group[0].title}」，请确认是否重复`,
          cardId: group[0].id,
          cardTitle: group[0].title
        });
      }
    }
  }

  return results;
}

export function generateDailyPlan(cards: PracticeCard[]): DailyPracticePlan {
  const items: DailyPracticeItem[] = [];
  const now = Date.now();
  const DAY = 86400000;

  for (const card of cards) {
    let priority = 0;
    const reasons: string[] = [];

    if (card.stageGoal && !card.stageGoal.completedAt) {
      const goalProgress = calculateGoalProgress(card);
      if (goalProgress) {
        if (goalProgress.status === 'overdue') {
          priority += 60;
          reasons.push('目标已逾期');
        } else if (goalProgress.status === 'near_due') {
          priority += 45;
          reasons.push('目标临期');
        } else if (goalProgress.status === 'in_progress') {
          priority += 25;
          reasons.push('目标进行中');
        } else if (goalProgress.status === 'achieved') {
          priority += 5;
          reasons.push('目标待确认');
        }
      }
    }

    if (!card.isReviewed && (card.practiceCount > 0 || card.familiarity !== 'new')) {
      priority += 50;
      reasons.push('待复盘');
    }

    if (card.familiarity === 'new') {
      priority += 40;
      reasons.push('尚未开始');
    } else if (card.familiarity === 'learning') {
      priority += 30;
      reasons.push('学习中');
    } else if (card.familiarity === 'practicing') {
      priority += 20;
      reasons.push('练习中');
    }

    if (card.lastPracticedAt) {
      const days = Math.floor((now - card.lastPracticedAt) / DAY);
      if (days >= 7) {
        priority += 25;
        reasons.push(`已 ${days} 天未练`);
      } else if (days >= 3) {
        priority += 10;
        reasons.push(`${days} 天未复习`);
      }
    } else if (card.familiarity !== 'new') {
      priority += 15;
      reasons.push('从未试讲');
    }

    if (card.errorPoints.length > 0) {
      priority += Math.min(card.errorPoints.length * 3, 15);
      reasons.push(`含 ${card.errorPoints.length} 个易错点`);
    }

    if (card.isFavorite) {
      priority += 10;
      reasons.push('收藏重点');
    }

    if (priority > 0) {
      items.push({
        card,
        priority,
        reason: reasons.join('、')
      });
    }
  }

  items.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (a.card.lastPracticedAt || 0) - (b.card.lastPracticedAt || 0);
  });

  const totalDuration = items.reduce((sum, it) => sum + it.card.durationMinutes, 0);
  const needReviewCount = items.filter((it) => !it.card.isReviewed && it.card.practiceCount > 0).length;
  const needPracticeCount = items.filter((it) => it.card.familiarity !== 'mastered').length;

  return {
    items,
    totalDurationMinutes: totalDuration,
    needReviewCount,
    needPracticeCount
  };
}

export function getRouteCards(route: TrainingRoute, cards: PracticeCard[]): RouteStepRef[] {
  const cardMap = new Map<string, PracticeCard>();
  cards.forEach((c) => cardMap.set(c.id, c));
  return route.stepIds.map((cardId) => {
    const card = cardMap.get(cardId) || null;
    return {
      cardId,
      card,
      missing: card === null
    };
  });
}

export function getRouteMissingStepIds(route: TrainingRoute, cards: PracticeCard[]): string[] {
  const idSet = new Set(cards.map((c) => c.id));
  return route.stepIds.filter((id) => !idSet.has(id));
}

export const DEFAULT_ROUTE_ZONE_ORDER = ['序厅', '历史展区', '主展区', '互动区', '尾厅'];

export function sortCardsByZoneOrder(
  cards: PracticeCard[],
  zoneOrder: string[] = DEFAULT_ROUTE_ZONE_ORDER
): PracticeCard[] {
  const orderMap = new Map<string, number>();
  zoneOrder.forEach((z, i) => orderMap.set(z, i));
  return [...cards].sort((a, b) => {
    const ai = orderMap.has(a.zone) ? orderMap.get(a.zone)! : Number.MAX_SAFE_INTEGER;
    const bi = orderMap.has(b.zone) ? orderMap.get(b.zone)! : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.createdAt - b.createdAt;
  });
}

export function cleanRouteMissingSteps(route: TrainingRoute, cards: PracticeCard[]): TrainingRoute {
  const idSet = new Set(cards.map((c) => c.id));
  return {
    ...route,
    stepIds: route.stepIds.filter((id) => idSet.has(id)),
    updatedAt: Date.now()
  };
}

function buildGoalSummary(card: PracticeCard): RouteGoalSummary | null {
  if (!card.stageGoal) return null;
  const progress = calculateGoalProgress(card);
  const goal = card.stageGoal;
  return {
    cardId: card.id,
    cardTitle: card.title,
    zone: card.zone,
    targetFamiliarity: goal.targetFamiliarity,
    targetPracticeCount: goal.targetPracticeCount,
    targetReviewDone: goal.targetReviewDone,
    dueDate: goal.dueDate,
    status: progress ? progress.status : 'none',
    overallProgress: progress ? progress.overallProgress : 0,
    completedAt: goal.completedAt
  };
}

export function calculateRouteSummary(
  route: TrainingRoute,
  cards: PracticeCard[],
  runs: RouteRunRecord[]
): RouteSummary {
  const refs = getRouteCards(route, cards);
  const validRefs = refs.filter((r) => r.card !== null) as Array<{ cardId: string; card: PracticeCard; missing: false }>;
  const missingStepIds = refs.filter((r) => r.missing).map((r) => r.cardId);
  const totalDurationMinutes = validRefs.reduce((sum, r) => sum + r.card.durationMinutes, 0);

  const routeRuns = runs
    .filter((r) => r.routeId === route.id && r.finishedAt)
    .sort((a, b) => (a.startedAt - b.startedAt));

  const completedDurations = routeRuns
    .map((r) => (r.finishedAt ? r.finishedAt - r.startedAt : 0))
    .filter((d) => d > 0);
  const averageDurationMs = completedDurations.length > 0
    ? Math.round(completedDurations.reduce((s, d) => s + d, 0) / completedDurations.length)
    : 0;

  const lastRun = routeRuns.length > 0 ? routeRuns[routeRuns.length - 1] : undefined;

  const goalSummaries: RouteGoalSummary[] = [];
  for (const ref of validRefs) {
    const summary = buildGoalSummary(ref.card);
    if (summary) goalSummaries.push(summary);
  }
  const achievedGoalCount = goalSummaries.filter((g) => g.status === 'achieved').length;
  const activeGoalCount = goalSummaries.filter((g) => g.status !== 'achieved').length;
  const nearDueGoalCount = goalSummaries.filter((g) => g.status === 'near_due').length;
  const overdueGoalCount = goalSummaries.filter((g) => g.status === 'overdue').length;
  const unreviewedCount = validRefs.filter((r) => !r.card.isReviewed).length;
  const missingCount = missingStepIds.length;

  return {
    route,
    totalSteps: refs.length,
    validSteps: validRefs.length,
    missingStepIds,
    totalDurationMinutes,
    unreviewedCount,
    nearDueGoalCount,
    overdueGoalCount,
    missingCount,
    runCount: routeRuns.length,
    lastRunAt: lastRun ? lastRun.finishedAt : route.lastRunAt,
    averageDurationMs,
    goalSummaries,
    achievedGoalCount,
    activeGoalCount
  };
}

export type RouteSortKey = 'targetDate' | 'updatedAt' | 'stepCount';

export function sortRoutes(
  routes: TrainingRoute[],
  cards: PracticeCard[],
  runs: RouteRunRecord[],
  sortKey: RouteSortKey,
  order: 'asc' | 'desc' = 'asc'
): TrainingRoute[] {
  const summaries = new Map<string, RouteSummary>();
  routes.forEach((r) => summaries.set(r.id, calculateRouteSummary(r, cards, runs)));
  const sorted = [...routes];
  sorted.sort((a, b) => {
    let diff = 0;
    if (sortKey === 'targetDate') {
      diff = a.targetDate - b.targetDate;
    } else if (sortKey === 'updatedAt') {
      diff = a.updatedAt - b.updatedAt;
    } else {
      const sa = summaries.get(a.id);
      const sb = summaries.get(b.id);
      diff = (sa ? sa.totalSteps : 0) - (sb ? sb.totalSteps : 0);
    }
    return order === 'asc' ? diff : -diff;
  });
  return sorted;
}

function scoreCardForRecommendation(card: PracticeCard, now: number): number {
  const DAY = 86400000;
  let score = 0;

  if (card.stageGoal && !card.stageGoal.completedAt) {
    const progress = calculateGoalProgress(card);
    if (progress) {
      if (progress.status === 'overdue') score += 60;
      else if (progress.status === 'near_due') score += 45;
      else if (progress.status === 'in_progress') score += 25;
      else if (progress.status === 'achieved') score += 5;
    }
  }

  if (!card.isReviewed && (card.practiceCount > 0 || card.familiarity !== 'new')) {
    score += 50;
  }

  if (card.familiarity === 'new') score += 40;
  else if (card.familiarity === 'learning') score += 30;
  else if (card.familiarity === 'practicing') score += 20;

  if (card.lastPracticedAt) {
    const days = Math.floor((now - card.lastPracticedAt) / DAY);
    if (days >= 7) score += 25;
    else if (days >= 3) score += 10;
  } else if (card.familiarity !== 'new') {
    score += 15;
  }

  if (card.errorPoints.length > 0) {
    score += Math.min(card.errorPoints.length * 3, 15);
  }

  if (card.isFavorite) score += 10;

  return score;
}

function interleaveByZone<T extends { zone: string }>(items: T[]): T[] {
  const zoneQueues = new Map<string, T[]>();
  const zoneOrder: string[] = [];
  for (const item of items) {
    const key = item.zone || '未设展区';
    if (!zoneQueues.has(key)) {
      zoneQueues.set(key, []);
      zoneOrder.push(key);
    }
    zoneQueues.get(key)!.push(item);
  }

  const result: T[] = [];
  const recent: string[] = [];
  const MAX_CONSECUTIVE = 2;
  let exhausted = false;

  while (!exhausted) {
    exhausted = true;
    let picked = false;

    for (const zone of zoneOrder) {
      const queue = zoneQueues.get(zone)!;
      if (queue.length === 0) continue;
      exhausted = false;

      const consecutive = recent.length >= MAX_CONSECUTIVE &&
        recent.slice(-MAX_CONSECUTIVE).every((z) => z === zone);
      if (consecutive) continue;

      result.push(queue.shift()!);
      recent.push(zone);
      if (recent.length > MAX_CONSECUTIVE) recent.shift();
      picked = true;
      break;
    }

    if (!picked && !exhausted) {
      for (const zone of zoneOrder) {
        const queue = zoneQueues.get(zone)!;
        if (queue.length > 0) {
          result.push(queue.shift()!);
          recent.push(zone);
          if (recent.length > MAX_CONSECUTIVE) recent.shift();
          break;
        }
      }
    }
  }

  return result;
}

export function generateRecommendedRoute(
  cards: PracticeCard[],
  _existingRoutes: TrainingRoute[] = [],
  _runs: RouteRunRecord[] = []
): TrainingRoute {
  const now = Date.now();
  const DAY = 86400000;

  const scored = cards
    .filter((c) => c.title.trim())
    .map((card) => ({ card, score: scoreCardForRecommendation(card, now) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.card.lastPracticedAt || 0) - (b.card.lastPracticedAt || 0);
    });

  const selected = interleaveByZone(scored.map((e) => e.card));

  const route = createEmptyRoute();
  const d = new Date(now);
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  route.name = `今日重点路线 ${dateStr}`;
  route.description = '根据复盘状态、掌握度、阶段目标与最近练习情况自动生成，可在编辑时调整顺序。';
  route.targetDate = now + DAY;
  route.stepIds = selected.map((c) => c.id);

  return route;
}

export function startRouteRun(routeId: string): RouteRunRecord {
  return {
    id: generateId(),
    routeId,
    startedAt: Date.now(),
    practicedCardIds: [],
    skippedCardIds: [],
    note: ''
  };
}

export function exportToJson(
  cards: PracticeCard[],
  routes: TrainingRoute[] = [],
  runs: RouteRunRecord[] = []
): string {
  const routeSummaries = routes.map((r) => calculateRouteSummary(r, cards, runs));
  const payload = {
    exportTime: new Date().toISOString(),
    version: 2,
    count: cards.length,
    cards,
    routes,
    routeRunRecords: runs,
    routeSummaries: routeSummaries.map((s) => ({
      routeId: s.route.id,
      routeName: s.route.name,
      totalSteps: s.totalSteps,
      validSteps: s.validSteps,
      missingStepIds: s.missingStepIds,
      totalDurationMinutes: s.totalDurationMinutes,
      runCount: s.runCount,
      lastRunAt: s.lastRunAt,
      averageDurationMs: s.averageDurationMs,
      achievedGoalCount: s.achievedGoalCount,
      activeGoalCount: s.activeGoalCount,
      goals: s.goalSummaries
    }))
  };
  return JSON.stringify(payload, null, 2);
}

export function exportToMarkdown(
  cards: PracticeCard[],
  routes: TrainingRoute[] = [],
  runs: RouteRunRecord[] = []
): string {
  const lines: string[] = [];
  lines.push(`# 展馆讲解训练台导出`);
  lines.push('');
  lines.push(`导出时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push(`条目数量：${cards.length}`);
  lines.push(`总预计时长：${formatDuration(cards.reduce((s, c) => s + c.durationMinutes, 0))}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const card of cards) {
    lines.push(`## ${card.title}`);
    lines.push('');
    lines.push(`- **展区**：${card.zone || '未设置'}`);
    lines.push(`- **建议时长**：${card.durationMinutes} 分钟`);
    lines.push(`- **掌握度**：${card.familiarity}`);
    lines.push(`- **是否收藏**：${card.isFavorite ? '是' : '否'}`);
    lines.push(`- **是否复盘**：${card.isReviewed ? '是' : '否'}`);
    lines.push(`- **试讲次数**：${card.practiceCount}`);
    lines.push(`- **最后试讲**：${formatDate(card.lastPracticedAt)}`);
    lines.push('');

    if (card.stageGoal) {
      const goal = card.stageGoal;
      const progress = calculateGoalProgress(card);
      lines.push('### 阶段目标');
      lines.push('');
      lines.push(`- **目标掌握度**：${goal.targetFamiliarity === 'maintain' ? '保持现状' : goal.targetFamiliarity}`);
      lines.push(`- **目标试讲次数**：${goal.targetPracticeCount} 次`);
      lines.push(`- **目标复盘**：${goal.targetReviewDone ? '需要完成' : '不需要'}`);
      lines.push(`- **开始日期**：${formatDate(goal.startDate)}`);
      lines.push(`- **截止日期**：${formatDate(goal.dueDate)}`);
      if (goal.completedAt) {
        lines.push(`- **完成时间**：${formatDate(goal.completedAt)}`);
      }
      if (progress) {
        lines.push(`- **当前进度**：${Math.round(progress.overallProgress * 100)}%`);
        lines.push(`- **目标状态**：${{
          achieved: '已达成',
          in_progress: '进行中',
          near_due: '临期',
          overdue: '已逾期',
          none: '未设置'
        }[progress.status]}`);
      }
      lines.push('');
    }

    if (card.keywords.length) {
      lines.push('**关键词**：');
      card.keywords.forEach((k) => lines.push(`- ${k}`));
      lines.push('');
    }
    if (card.errorPoints.length) {
      lines.push('**易错点**：');
      card.errorPoints.forEach((e) => lines.push(`- ${e}`));
      lines.push('');
    }
    if (card.alternatives.length) {
      lines.push('**替代表达**：');
      card.alternatives.forEach((a) => lines.push(`- ${a}`));
      lines.push('');
    }
    if (card.reviewNote) {
      lines.push(`**复盘备注**：\n\n${card.reviewNote}`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  if (routes.length > 0) {
    lines.push('# 训练路线');
    lines.push('');
    for (const route of routes) {
      const summary = calculateRouteSummary(route, cards, runs);
      const routeRuns = runs.filter((r) => r.routeId === route.id).sort((a, b) => a.startedAt - b.startedAt);
      lines.push(`## ${route.name || '(未命名路线)'}`);
      lines.push('');
      if (route.description) {
        lines.push(route.description);
        lines.push('');
      }
      lines.push(`- **目标日期**：${formatDate(route.targetDate)}`);
      lines.push(`- **创建时间**：${formatDateTime(route.createdAt)}`);
      lines.push(`- **最近修改**：${formatDateTime(route.updatedAt)}`);
      if (route.archivedAt) lines.push(`- **归档时间**：${formatDateTime(route.archivedAt)}`);
      if (route.lastRunAt) lines.push(`- **最近执行**：${formatDateTime(route.lastRunAt)}`);
      lines.push(`- **步骤数**：${summary.totalSteps}（有效 ${summary.validSteps}${summary.missingStepIds.length > 0 ? `，缺失 ${summary.missingStepIds.length}` : ''}）`);
      lines.push(`- **预计总时长**：${formatDuration(summary.totalDurationMinutes)}`);
      lines.push(`- **累计执行次数**：${summary.runCount}`);
      if (summary.averageDurationMs > 0) {
        const avgMin = Math.round(summary.averageDurationMs / 60000);
        lines.push(`- **平均执行时长**：${avgMin} 分钟`);
      }
      lines.push('');

      lines.push('### 关联步骤');
      lines.push('');
      const refs = getRouteCards(route, cards);
      if (refs.length === 0) {
        lines.push('_暂无步骤_');
      } else {
        refs.forEach((ref, idx) => {
          if (ref.missing) {
            lines.push(`${idx + 1}. ⚠️ **缺失条目**（ID: ${ref.cardId}）`);
          } else {
            const c = ref.card!;
            lines.push(`${idx + 1}. ${c.title}（📍 ${c.zone || '未设展区'} · ⏱️ ${c.durationMinutes} 分钟）`);
          }
        });
      }
      lines.push('');

      if (summary.goalSummaries.length > 0) {
        lines.push('### 阶段目标摘要');
        lines.push('');
        for (const g of summary.goalSummaries) {
          const statusLabel = GOAL_STATUS_LABELS[g.status];
          const progressPercent = Math.round(g.overallProgress * 100);
          lines.push(`- **${g.cardTitle}**（${g.zone || '未设展区'}）：目标 ${g.targetFamiliarity === 'maintain' ? '保持现状' : g.targetFamiliarity} / ${g.targetPracticeCount} 次试讲${g.targetReviewDone ? ' / 需复盘' : ''}，截止 ${formatDate(g.dueDate)}，状态 ${statusLabel}（${progressPercent}%）${g.completedAt ? `，完成于 ${formatDate(g.completedAt)}` : ''}`);
        }
        lines.push(`- **汇总**：已达成 ${summary.achievedGoalCount}，进行中 ${summary.activeGoalCount}`);
        lines.push('');
      }

      if (routeRuns.length > 0) {
        lines.push('### 执行记录');
        lines.push('');
        routeRuns.forEach((run, idx) => {
          const status = run.finishedAt ? '已完成' : '进行中';
          const duration = run.finishedAt ? `，耗时 ${Math.round((run.finishedAt - run.startedAt) / 60000)} 分钟` : '';
          lines.push(`${idx + 1}. ${formatDateTime(run.startedAt)} - ${status}${duration}，已练 ${run.practicedCardIds.length}，跳过 ${run.skippedCardIds.length}${run.note ? `，备注：${run.note}` : ''}`);
        });
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function splitTags(input: string): string[] {
  return input
    .split(/[,，、\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function calculateGoalProgress(card: PracticeCard): GoalProgress | null {
  if (!card.stageGoal) return null;

  const goal = card.stageGoal;
  const now = Date.now();
  const DAY = 86400000;

  const daysRemaining = Math.ceil((goal.dueDate - now) / DAY);

  const practicesInPeriod = card.practiceHistory.filter((ts) => ts >= goal.startDate).length;
  const safeTargetPractice = Math.max(0, goal.targetPracticeCount);
  const practiceProgress = safeTargetPractice > 0
    ? Math.min(1, Math.max(0, practicesInPeriod / safeTargetPractice))
    : 1;

  let familiarityProgress = 1;
  if (goal.targetFamiliarity !== 'maintain') {
    const currentIdx = getFamiliarityIndex(card.familiarity);
    const targetIdx = getFamiliarityIndex(goal.targetFamiliarity);
    const startIdx = getFamiliarityIndex('new');
    if (targetIdx > startIdx) {
      const effectiveCurrent = Math.min(currentIdx, targetIdx);
      familiarityProgress = (effectiveCurrent - startIdx) / (targetIdx - startIdx);
    } else {
      familiarityProgress = currentIdx >= targetIdx ? 1 : 0;
    }
  }

  const reviewProgress = goal.targetReviewDone
    ? (card.isReviewed ? 1 : 0)
    : 1;

  let overallProgress = (practiceProgress + familiarityProgress + reviewProgress) / 3;

  let status: GoalStatus;
  if (goal.completedAt) {
    status = 'achieved';
    overallProgress = 1;
  } else if (overallProgress >= 1) {
    status = 'achieved';
    overallProgress = 1;
  } else if (daysRemaining < 0) {
    status = 'overdue';
  } else if (daysRemaining <= GOAL_NEAR_DUE_DAYS) {
    status = 'near_due';
  } else {
    status = 'in_progress';
  }

  return {
    practiceProgress,
    familiarityProgress,
    reviewProgress,
    overallProgress,
    daysRemaining,
    status
  };
}

export function getGoalStatus(card: PracticeCard): GoalStatus {
  const progress = calculateGoalProgress(card);
  return progress ? progress.status : 'none';
}

export function isGoalAchieved(card: PracticeCard): boolean {
  const progress = calculateGoalProgress(card);
  return progress !== null && progress.status === 'achieved';
}

export function getPracticesInGoalPeriod(card: PracticeCard): number {
  if (!card.stageGoal) return 0;
  const startDate = card.stageGoal.startDate;
  return card.practiceHistory.filter((ts) => ts >= startDate).length;
}

export function formatDaysRemaining(days: number): string {
  if (days > 0) return `剩余 ${days} 天`;
  if (days === 0) return '今天截止';
  return `逾期 ${Math.abs(days)} 天`;
}
